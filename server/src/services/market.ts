import type pg from 'pg';
import { ItemError, MARKET, marketFee } from '@astral/shared';
import { HttpError } from './auth.js';
import { tx, ownChar, idem, notInBattle, UUID } from './common.js';
import { addItem } from './inventory.js';
import { pool } from '../db/pool.js';
import { systemMsg } from './social.js';
/**
 * PHASE 9 player market (TD-017). Items are escrowed: listing removes them from the seller's inventory into
 * market_listings; buying moves gold buyer→seller (minus fee) and the item to the buyer in one transaction under the
 * listing row lock (status active→sold is the single state flip). Cancel / reclaim after expiry returns the escrow.
 * All mutations are requestId-idempotent (transactions UNIQUE key), so double clicks / retries never duplicate gold or items.
 */
const inTown = (ch: any) => { if (ch.map_id !== MARKET.mapId) throw new HttpError(409, 'market_town_only'); };
const lid = (v: unknown) => { if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(404, 'listing_not_found'); return v; };
const int = (v: unknown, lo: number, hi: number, code: string) => { const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) throw new HttpError(400, code); return n; };
const row = (r: any) => ({ id: r.id, itemId: r.item_id, name: r.name, category: r.category, rarity: r.rarity, quantity: r.quantity, enhance: r.enhance_level,
  price: Number(r.price), seller: r.seller_name, sellerId: r.seller_character_id, status: r.status, expiresAt: r.expires_at, expired: r.status === 'active' && new Date(r.expires_at) < new Date(),
  createdAt: r.created_at, closedAt: r.closed_at, buyer: r.buyer_name ?? null, fee: r.fee == null ? null : Number(r.fee) });
const SEL = `SELECT l.*, d.name, d.category, d.rarity, s.name seller_name, b.name buyer_name FROM market_listings l JOIN item_definitions d ON d.id=l.item_id
  JOIN characters s ON s.id=l.seller_character_id LEFT JOIN characters b ON b.id=l.buyer_character_id`;

/** browse active, unexpired listings (optionally by name / category), cheapest first */
export async function browse(q: { search?: unknown; category?: unknown; page?: unknown }) {
  const s = typeof q.search === 'string' ? q.search.trim().slice(0, 30) : '', cat = typeof q.category === 'string' ? q.category : '';
  const page = Math.max(0, Math.min(50, Math.floor(Number(q.page) || 0)));
  const r = await pool.query(`${SEL} WHERE l.status='active' AND l.expires_at > now() AND ($1='' OR d.name ILIKE '%'||$1||'%') AND ($2='' OR d.category=$2)
    ORDER BY l.price/l.quantity, l.created_at LIMIT 30 OFFSET $3`, [s.replace(/[%_\\]/g, (m) => '\\' + m), cat, page * 30]);
  return { listings: r.rows.map(row), feeRate: MARKET.feeRate, durationsH: MARKET.durationsH };
}
/** own listings (active / expired-awaiting-reclaim / closed) + purchases = trade history */
export const mine = (userId: string, characterId: string) => tx(async (c) => {
  const me = await ownChar(c, userId, characterId);
  const sold = (await c.query(`${SEL} WHERE l.seller_character_id=$1 ORDER BY l.created_at DESC LIMIT 50`, [me.id])).rows.map(row);
  const bought = (await c.query(`${SEL} WHERE l.buyer_character_id=$1 ORDER BY l.closed_at DESC LIMIT 50`, [me.id])).rows.map(row);
  return { listings: sold, purchases: bought };
});

export const createListing = (userId: string, characterId: unknown, b: any) => tx(async (c) => {
  const ch = await ownChar(c, userId, characterId, true);
  return idem(c, ch.id, b.requestId, 'market_list', async () => {
    inTown(ch); await notInBattle(c, ch.id);
    if (typeof b.inventoryId !== 'string' || !UUID.test(b.inventoryId)) throw new HttpError(404, 'item_not_found');
    const price = int(b.price, MARKET.minPrice, MARKET.maxPrice, 'invalid_price');
    const hours = Number(b.hours); if (!(MARKET.durationsH as readonly number[]).includes(hours)) throw new HttpError(400, 'invalid_duration');
    const n = (await c.query(`SELECT count(*)::int n FROM market_listings WHERE seller_character_id=$1 AND status='active'`, [ch.id])).rows[0].n;
    if (n >= MARKET.maxActivePerCharacter) throw new HttpError(409, 'too_many_listings');
    const it = (await c.query(`SELECT i.id, i.item_id, i.quantity, i.enhance_level, d.name, d.category, EXISTS(SELECT 1 FROM character_equipment e WHERE e.inventory_id=i.id) eq
      FROM inventory i JOIN item_definitions d ON d.id=i.item_id WHERE i.id=$1 AND i.character_id=$2 FOR UPDATE OF i`, [b.inventoryId, ch.id])).rows[0];
    if (!it) throw new HttpError(404, 'item_not_found');
    if (it.eq) throw new ItemError('equipped');
    if (it.category === 'quest') throw new ItemError('cannot_sell');
    const qty = int(b.qty ?? it.quantity, 1, 999, 'invalid_qty'); if (qty > it.quantity) throw new ItemError('not_enough_materials');
    if (qty === it.quantity) await c.query('DELETE FROM inventory WHERE id=$1', [it.id]); else await c.query('UPDATE inventory SET quantity=quantity-$2 WHERE id=$1', [it.id, qty]);
    const l = (await c.query(`INSERT INTO market_listings(seller_character_id,item_id,quantity,enhance_level,price,fee_rate,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+($7||' hours')::interval) RETURNING id, expires_at`,
      [ch.id, it.item_id, qty, it.enhance_level, price, MARKET.feeRate, String(hours)])).rows[0];
    return { listingId: l.id, itemId: it.item_id, name: it.name, qty, price, expiresAt: l.expires_at, fee: marketFee(price), itemsDelta: [{ itemId: it.item_id, qty: -qty, escrow: l.id }] };
  });
});

async function giveBack(c: pg.PoolClient, charId: string, l: any) {
  const ids = await addItem(c, charId, l.item_id, l.quantity); // strict: needs a free slot
  if (l.enhance_level) await c.query('UPDATE inventory SET enhance_level=$2 WHERE id = ANY($1)', [ids, l.enhance_level]);
}
export const buyListing = (userId: string, characterId: unknown, b: any) => tx(async (c) => {
  const ch = await ownChar(c, userId, characterId, false);
  let notifySeller: { id: string; text: string } | null = null;
  // Peek the seller, then lock buyer+seller in id order BEFORE idem so (1) crossed buys cannot
  // deadlock and (2) a retried requestId on the same buyer still serialises into a replay.
  const peek = (await c.query('SELECT seller_character_id FROM market_listings WHERE id=$1', [lid(b.listingId)])).rows[0];
  if (!peek) throw new HttpError(404, 'listing_not_found');
  await c.query('SELECT id FROM characters WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[ch.id, peek.seller_character_id]]);
  const out = await idem(c, ch.id, b.requestId, 'market_buy', async () => {
    const me = await ownChar(c, userId, characterId, false);
    inTown(me); await notInBattle(c, me.id);
    const l = (await c.query(`SELECT l.*, d.name FROM market_listings l JOIN item_definitions d ON d.id=l.item_id WHERE l.id=$1 FOR UPDATE OF l`, [lid(b.listingId)])).rows[0];
    if (!l) throw new HttpError(404, 'listing_not_found');
    if (l.status !== 'active') throw new HttpError(409, 'listing_closed');
    if (new Date(l.expires_at) < new Date()) throw new HttpError(409, 'listing_expired');
    if (l.seller_character_id === me.id) throw new HttpError(409, 'own_listing');
    if ((await c.query('SELECT 1 FROM characters WHERE id=$1 AND user_id=$2', [l.seller_character_id, userId])).rowCount) throw new HttpError(409, 'own_listing'); // no trading between one account's characters
    if (b.expectedPrice !== undefined && Number(b.expectedPrice) !== Number(l.price)) throw new HttpError(409, 'price_changed');
    const price = Number(l.price), fee = marketFee(price, Number(l.fee_rate));
    const paid = await c.query('UPDATE characters SET gold=gold-$2, updated_at=now() WHERE id=$1 AND gold >= $2 RETURNING gold', [me.id, price]);
    if (!paid.rowCount) throw new ItemError('not_enough_gold');
    await giveBack(c, ch.id, l);
    await c.query(`UPDATE market_listings SET status='sold', buyer_character_id=$2, fee=$3, closed_at=now() WHERE id=$1 AND status='active'`, [l.id, ch.id, fee]);
    await c.query(`INSERT INTO market_price_history(item_id,unit_price,quantity) VALUES($1,$2,$3)`, [l.item_id, Math.max(1, Math.floor(price / Math.max(1, Number(l.quantity)))), l.quantity]);
    await c.query('UPDATE characters SET gold=gold+$2, updated_at=now() WHERE id=$1', [l.seller_character_id, price - fee]);
    await c.query(`INSERT INTO transactions(character_id,kind,gold_delta,items_delta,idempotency_key,ref_id) VALUES($1,'market_sale',$2,$3,$4,$5)`,
      [l.seller_character_id, price - fee, JSON.stringify([{ itemId: l.item_id, qty: -l.quantity, fee }]), `market:${l.id}:sale`, l.id]);
    notifySeller = { id: l.seller_character_id, text: `取引所: ${l.name}×${l.quantity} が ${price}G で売れました（手数料 ${fee}G、受取 ${price - fee}G）` };
    return { listingId: l.id, itemId: l.item_id, name: l.name, qty: l.quantity, price, gold: Number(paid.rows[0].gold), goldDelta: -price, itemsDelta: [{ itemId: l.item_id, qty: l.quantity }] };
  });
  if (notifySeller && !out.replayed) { const n = notifySeller as { id: string; text: string }; setImmediate(() => systemMsg([n.id], n.text).catch(() => {})); }
  return out;
});
/** seller cancels an active listing, or reclaims an expired one: escrow goes back to the inventory */
export const cancelListing = (userId: string, characterId: unknown, b: any) => tx(async (c) => {
  const ch = await ownChar(c, userId, characterId, true);
  return idem(c, ch.id, b.requestId, 'market_cancel', async () => {
    const l = (await c.query('SELECT * FROM market_listings WHERE id=$1 FOR UPDATE', [lid(b.listingId)])).rows[0];
    if (!l || l.seller_character_id !== ch.id) throw new HttpError(404, 'listing_not_found');
    if (l.status !== 'active') throw new HttpError(409, 'listing_closed');
    const expired = new Date(l.expires_at) < new Date();
    await giveBack(c, ch.id, l);
    await c.query(`UPDATE market_listings SET status=$2, closed_at=now() WHERE id=$1`, [l.id, expired ? 'reclaimed' : 'cancelled']);
    return { listingId: l.id, status: expired ? 'reclaimed' : 'cancelled', itemsDelta: [{ itemId: l.item_id, qty: l.quantity }] };
  });
});

export async function priceHistory(itemId: unknown) {
  if (typeof itemId !== 'string' || !itemId) return { itemId, sales: [], avg: null };
  const sales = (await pool.query(`SELECT unit_price "unitPrice", quantity, sold_at "soldAt" FROM market_price_history WHERE item_id=$1 ORDER BY sold_at DESC LIMIT 20`, [itemId])).rows;
  const avg = sales.length ? Math.round(sales.reduce((t, r) => t + Number(r.unitPrice), 0) / sales.length) : null;
  return { itemId, sales, avg };
}
