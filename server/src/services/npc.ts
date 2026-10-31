import { ItemError, innCost } from '@astral/shared';
import { HttpError } from './auth.js';
import { tx, ownChar, idem, notInBattle, UUID } from './common.js';
import { addItem, spendGold } from './inventory.js';
import { assertNearNpc } from './world.js';
/** PHASE 5 shop / inn. Prices come only from the DB; every mutation is requestId-idempotent under the character row lock. */
const qtyOf = (q: unknown) => { const n = Number(q ?? 1); if (!Number.isInteger(n) || n < 1 || n > 99) throw new HttpError(400, 'invalid_qty'); return n; };
export async function shopList(npcId: string) {
  return tx(async (c) => (await c.query(`SELECT d.id "itemId", d.name, d.category, d.buy_price price, d.description FROM shop_items s JOIN item_definitions d ON d.id=s.item_id
    WHERE s.npc_id=$1 AND d.buy_price IS NOT NULL ORDER BY s.sort`, [npcId])).rows);
}
export const buy = (userId: string, characterId: unknown, b: any) => tx(async (c) => {
  const ch = await ownChar(c, userId, characterId, true);
  return idem(c, ch.id, b.requestId, 'shop_buy', async () => {
    await notInBattle(c, ch.id);
    const npcId = String(b.npcId ?? ''), qty = qtyOf(b.qty);
    const it = (await c.query(`SELECT d.id, d.name, d.buy_price FROM shop_items s JOIN item_definitions d ON d.id=s.item_id WHERE s.npc_id=$1 AND s.item_id=$2 AND d.buy_price IS NOT NULL`, [npcId, String(b.itemId ?? '')])).rows[0];
    if (!it) throw new HttpError(404, 'not_sold_here');
    assertNearNpc(ch, npcId);
    const cost = it.buy_price * qty;
    await spendGold(c, ch.id, cost); await addItem(c, ch.id, it.id, qty);
    const gold = Number((await c.query('SELECT gold FROM characters WHERE id=$1', [ch.id])).rows[0].gold);
    return { itemId: it.id, name: it.name, qty, cost, gold, goldDelta: -cost, itemsDelta: [{ itemId: it.id, qty }] };
  });
});
export const sell = (userId: string, characterId: unknown, b: any) => tx(async (c) => {
  const ch = await ownChar(c, userId, characterId, true);
  return idem(c, ch.id, b.requestId, 'shop_sell', async () => {
    await notInBattle(c, ch.id);
    const npcId = String(b.npcId ?? ''), qty = qtyOf(b.qty);
    if (!(await c.query('SELECT 1 FROM shop_items WHERE npc_id=$1 LIMIT 1', [npcId])).rowCount) throw new HttpError(404, 'not_a_shop');
    assertNearNpc(ch, npcId);
    if (typeof b.inventoryId !== 'string' || !UUID.test(b.inventoryId)) throw new HttpError(404, 'item_not_found');
    const row = (await c.query(`SELECT i.id, i.item_id, i.quantity, d.name, d.sell_price, d.category, EXISTS(SELECT 1 FROM character_equipment e WHERE e.inventory_id=i.id) eq
      FROM inventory i JOIN item_definitions d ON d.id=i.item_id WHERE i.id=$1 AND i.character_id=$2 FOR UPDATE OF i`, [b.inventoryId, ch.id])).rows[0];
    if (!row) throw new HttpError(404, 'item_not_found');
    if (row.eq) throw new ItemError('equipped');
    if (row.category === 'quest') throw new ItemError('cannot_sell');
    if (row.quantity < qty) throw new ItemError('not_enough_materials');
    if (row.quantity === qty) await c.query('DELETE FROM inventory WHERE id=$1', [row.id]); else await c.query('UPDATE inventory SET quantity=quantity-$2 WHERE id=$1', [row.id, qty]);
    const earn = row.sell_price * qty;
    const gold = Number((await c.query('UPDATE characters SET gold=gold+$2, updated_at=now() WHERE id=$1 RETURNING gold', [ch.id, earn])).rows[0].gold);
    return { itemId: row.item_id, name: row.name, qty, earn, gold, goldDelta: earn, itemsDelta: [{ itemId: row.item_id, qty: -qty }] };
  });
});
export const INN = 'npc_inn_hana';
export const rest = (userId: string, characterId: unknown, requestId: unknown) => tx(async (c) => {
  const ch = await ownChar(c, userId, characterId, true);
  return idem(c, ch.id, requestId, 'inn', async () => {
    await notInBattle(c, ch.id);
    assertNearNpc(ch, INN);
    if (ch.hp >= ch.max_hp && ch.mp >= ch.max_mp) throw new ItemError('already_full');
    const cost = innCost(ch.level);
    await spendGold(c, ch.id, cost);
    await c.query('UPDATE character_stats SET hp=max_hp, mp=max_mp WHERE character_id=$1', [ch.id]);
    const gold = Number((await c.query('SELECT gold FROM characters WHERE id=$1', [ch.id])).rows[0].gold);
    return { cost, gold, hp: ch.max_hp, mp: ch.max_mp, goldDelta: -cost };
  });
});
