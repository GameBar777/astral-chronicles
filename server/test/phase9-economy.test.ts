import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createGameServer } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { resetDb } from './setup-db.js';
import { __clearRankingCache } from '../src/services/ranking.js';
const PORT = 25679, B = `http://127.0.0.1:${PORT}/api`;
const { gameServer } = createGameServer({ authLimit: 1000, createLimit: 1000, actionLimit: 10000 } as any);
const call = async (method: string, path: string, body?: unknown, token = '') => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const user = async (email: string, name: string, cls = 'warrior') => {
  await call('POST', '/auth/register', { email, password: 'password123' });
  const t = (await call('POST', '/auth/login', { email, password: 'password123' })).body.token;
  const c = await call('POST', '/characters', { name, class: cls, appearance: { bodyType: 'a', hairStyle: 1, hairColor: 2, skinColor: 0 } }, t);
  return { t, id: c.body.id as string };
};
const rid = () => randomUUID();
const S = (u: any, path: string, body: any = {}) => call('POST', `/characters/${u.id}/${path}`, body, u.t);
const gold = async (id: string) => Number((await pool.query('SELECT gold FROM characters WHERE id=$1', [id])).rows[0].gold);
const setGold = (id: string, g: number) => pool.query('UPDATE characters SET gold=$2 WHERE id=$1', [id, g]);
const give = async (id: string, itemId: string, qty: number, enh = 0) => (await pool.query('INSERT INTO inventory(character_id,item_id,quantity,enhance_level) VALUES($1,$2,$3,$4) RETURNING id', [id, itemId, qty, enh])).rows[0].id as string;
const count = async (id: string, itemId: string) => Number((await pool.query('SELECT coalesce(sum(quantity),0)::int n FROM inventory WHERE character_id=$1 AND item_id=$2', [id, itemId])).rows[0].n);
let A: any, Bu: any, C: any, A2: any;
beforeAll(async () => {
  await resetDb(); await gameServer.listen(PORT);
  A = await user('a9@example.com', '商人A'); Bu = await user('b9@example.com', '商人B'); C = await user('c9@example.com', '商人C', 'mage');
  // second character of A's account (self-trading guard)
  A2 = { t: A.t, id: (await call('POST', '/characters', { name: '商人A二', class: 'knight', appearance: { bodyType: 'a', hairStyle: 1, hairColor: 2, skinColor: 0 } }, A.t)).body.id };
});
afterAll(async () => { await gameServer.gracefullyShutdown(false).catch(() => {}); await pool.end(); });

describe('PHASE 9 player market', () => {
  let herbInv: string, L1: string;
  it('listing: validates input, escrows the item, enforces town-only and equipped/quest rules', async () => {
    herbInv = await give(A.id, 'herb', 10);
    expect((await S(A, 'market/list', { inventoryId: herbInv, qty: 4, price: 0, hours: 24, requestId: rid() })).body.error).toBe('invalid_price');
    expect((await S(A, 'market/list', { inventoryId: herbInv, qty: 4, price: 100, hours: 5, requestId: rid() })).body.error).toBe('invalid_duration');
    expect((await S(A, 'market/list', { inventoryId: herbInv, qty: 11, price: 100, hours: 24, requestId: rid() })).body.error).toBe('not_enough_materials');
    expect((await S(A, 'market/list', { inventoryId: herbInv, qty: 4, price: 100, hours: 24 })).body.error).toBe('invalid_request_id');
    expect((await S(A, 'market/list', { inventoryId: randomUUID(), qty: 1, price: 100, hours: 24, requestId: rid() })).body.error).toBe('item_not_found');
    expect((await S(Bu, 'market/list', { inventoryId: herbInv, qty: 1, price: 100, hours: 24, requestId: rid() })).body.error).toBe('item_not_found'); // not B's item
    await pool.query(`UPDATE characters SET map_id='green_meadow' WHERE id=$1`, [A.id]);
    expect((await S(A, 'market/list', { inventoryId: herbInv, qty: 4, price: 100, hours: 24, requestId: rid() })).body.error).toBe('market_town_only');
    await pool.query(`UPDATE characters SET map_id='asteria' WHERE id=$1`, [A.id]);
    const q = await give(A.id, 'chief_letter', 1);
    expect((await S(A, 'market/list', { inventoryId: q, qty: 1, price: 10, hours: 1, requestId: rid() })).body.error).toBe('cannot_sell');
    const r = rid(); const ok = await S(A, 'market/list', { inventoryId: herbInv, qty: 4, price: 100, hours: 24, requestId: r });
    expect(ok.status).toBe(200); L1 = ok.body.listingId; expect(ok.body.fee).toBe(5);
    expect(await count(A.id, 'herb')).toBe(6);
    const again = await S(A, 'market/list', { inventoryId: herbInv, qty: 4, price: 100, hours: 24, requestId: r }); // replay
    expect(again.body.replayed).toBe(true); expect(await count(A.id, 'herb')).toBe(6);
    const br = await call('GET', `/market?search=${encodeURIComponent('薬草')}`, undefined, A.t);
    expect(br.body.listings.map((l: any) => l.id)).toContain(L1);
  });
  it('buying: gold moves buyer → seller minus 5% fee; item moves; no self / same-account trades; concurrent buys sell once', async () => {
    expect((await S(A, 'market/buy', { listingId: L1, requestId: rid() })).body.error).toBe('own_listing');
    expect((await S(A2, 'market/buy', { listingId: L1, requestId: rid() })).body.error).toBe('own_listing');
    await setGold(Bu.id, 50);
    expect((await S(Bu, 'market/buy', { listingId: L1, requestId: rid() })).body.error).toBe('not_enough_gold');
    await setGold(Bu.id, 1000); await setGold(C.id, 1000); const a0 = await gold(A.id);
    expect((await S(Bu, 'market/buy', { listingId: L1, expectedPrice: 99, requestId: rid() })).body.error).toBe('price_changed');
    const rs = await Promise.all([S(Bu, 'market/buy', { listingId: L1, requestId: rid() }), S(C, 'market/buy', { listingId: L1, requestId: rid() }), S(Bu, 'market/buy', { listingId: L1, requestId: rid() })]);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.body?.error === 'listing_closed')).toHaveLength(2);
    const winner = rs.find((r) => r.status === 200)!.body; const W = (await count(Bu.id, 'herb')) ? Bu : C;
    expect(await count(W.id, 'herb')).toBe(4);
    expect(await gold(W.id)).toBe(900); expect(winner.gold).toBe(900);
    expect(await gold(A.id)).toBe(a0 + 95);
    const loser = W === Bu ? C : Bu; expect(await gold(loser.id)).toBe(1000);
    // gold conservation: buyer paid 100, seller got 95, 5 removed as fee
    const l = (await pool.query('SELECT status, fee FROM market_listings WHERE id=$1', [L1])).rows[0]; expect(l).toEqual({ status: 'sold', fee: '5' });
    expect((await pool.query(`SELECT count(*)::int n FROM transactions WHERE idempotency_key=$1`, [`market:${L1}:sale`])).rows[0].n).toBe(1);
  });
  it('buy replay with the same requestId charges once', async () => {
    const inv = await give(A.id, 'iron_ore', 3); const l = (await S(A, 'market/list', { inventoryId: inv, qty: 3, price: 30, hours: 1, requestId: rid() })).body.listingId;
    const g0 = await gold(Bu.id), r = rid();
    const [x, y] = await Promise.all([S(Bu, 'market/buy', { listingId: l, requestId: r }), S(Bu, 'market/buy', { listingId: l, requestId: r })]);
    expect([x.status, y.status]).toEqual([200, 200]); expect([x.body.replayed, y.body.replayed].sort()).toEqual([false, true]);
    expect(await gold(Bu.id)).toBe(g0 - 30); expect(await count(Bu.id, 'iron_ore')).toBe(3);
  });
  it('enhanced equipment keeps its +level through the market; equipped items cannot be listed', async () => {
    const sw = await give(A.id, 'wooden_sword', 1, 3);
    await S(A, 'equip', { inventoryId: sw });
    expect((await S(A, 'market/list', { inventoryId: sw, price: 500, hours: 24, requestId: rid() })).body.error).toBe('equipped');
    await S(A, 'unequip', { slot: 'weapon' });
    const l = (await S(A, 'market/list', { inventoryId: sw, price: 500, hours: 24, requestId: rid() })).body.listingId; expect(l).toBeTruthy();
    expect((await S(Bu, 'market/buy', { listingId: l, requestId: rid() })).status).toBe(200);
    expect((await pool.query(`SELECT max(enhance_level)::int e FROM inventory WHERE character_id=$1 AND item_id='wooden_sword'`, [Bu.id])).rows[0].e).toBe(3);
  });
  it('cancel returns escrow; expired listings cannot be bought and are reclaimed; history lists both sides', async () => {
    const inv = await give(A.id, 'beast_hide', 2);
    const l1 = (await S(A, 'market/list', { inventoryId: inv, qty: 1, price: 20, hours: 1, requestId: rid() })).body.listingId;
    const l2 = (await S(A, 'market/list', { inventoryId: inv, qty: 1, price: 20, hours: 1, requestId: rid() })).body.listingId;
    expect(await count(A.id, 'beast_hide')).toBe(0);
    expect((await S(Bu, 'market/cancel', { listingId: l1, requestId: rid() })).body.error).toBe('listing_not_found');
    const c1 = await S(A, 'market/cancel', { listingId: l1, requestId: rid() }); expect(c1.body.status).toBe('cancelled');
    expect((await S(A, 'market/cancel', { listingId: l1, requestId: rid() })).body.error).toBe('listing_closed');
    await pool.query(`UPDATE market_listings SET expires_at=now()-interval '1 second' WHERE id=$1`, [l2]);
    expect((await S(Bu, 'market/buy', { listingId: l2, requestId: rid() })).body.error).toBe('listing_expired');
    expect((await call('GET', '/market', undefined, A.t)).body.listings.map((x: any) => x.id)).not.toContain(l2);
    expect((await S(A, 'market/cancel', { listingId: l2, requestId: rid() })).body.status).toBe('reclaimed');
    expect(await count(A.id, 'beast_hide')).toBe(2);
    const h = (await call('GET', `/characters/${A.id}/market`, undefined, A.t)).body;
    expect(h.listings.map((x: any) => x.status)).toEqual(expect.arrayContaining(['sold', 'cancelled', 'reclaimed']));
    const hb = (await call('GET', `/characters/${Bu.id}/market`, undefined, Bu.t)).body; expect(hb.purchases.length).toBeGreaterThanOrEqual(2);
  });
  it('active listing cap', async () => {
    const inv = await give(C.id, 'herb', 20);
    for (let i = 0; i < 10; i++) expect((await S(C, 'market/list', { inventoryId: inv, qty: 1, price: 5, hours: 1, requestId: rid() })).status).toBe(200);
    expect((await S(C, 'market/list', { inventoryId: inv, qty: 1, price: 5, hours: 1, requestId: rid() })).body.error).toBe('too_many_listings');
  });
});

describe('PHASE 9 guild management + rankings', () => {
  let G: string;
  it('roles: leader promotes/demotes officers; officers can invite and kick members only', async () => {
    G = (await S(A, 'guild/create', { name: '星詠み団' })).body.guildId;
    for (const u of [Bu, C]) { await S(A, 'guild/invite', { name: u === Bu ? '商人B' : '商人C' }); await S(u, 'guild/accept', { guildId: G }); }
    expect((await S(Bu, 'guild/rank', { characterId: C.id, rank: 'officer' })).body.error).toBe('not_guild_leader');
    expect((await S(A, 'guild/rank', { characterId: Bu.id, rank: 'boss' })).body.error).toBe('invalid_rank');
    expect((await S(A, 'guild/rank', { characterId: Bu.id, rank: 'officer' })).body.ok).toBe(true);
    const v = (await call('GET', `/characters/${A.id}/social`, undefined, A.t)).body.guild;
    expect(v.members.find((m: any) => m.id === Bu.id).rank).toBe('officer');
    expect((await S(Bu, 'guild/kick', { characterId: A.id })).body.error).toBe('not_allowed');
    expect((await S(C, 'guild/kick', { characterId: Bu.id })).body.error).toBe('not_allowed');
    expect((await S(Bu, 'guild/kick', { characterId: C.id })).body.ok).toBe(true);
    expect((await call('GET', `/characters/${C.id}/social`, undefined, C.t)).body.guild).toBeNull();
    expect((await S(A, 'guild/rank', { characterId: Bu.id, rank: 'member' })).body.ok).toBe(true);
  });
  it('leader transfer and disband (needs the exact guild name)', async () => {
    expect((await S(A, 'guild/transfer', { characterId: Bu.id })).body.ok).toBe(true);
    const ranks = (await pool.query('SELECT character_id, rank FROM guild_members WHERE guild_id=$1', [G])).rows;
    expect(ranks.find((r) => r.character_id === Bu.id).rank).toBe('leader'); expect(ranks.find((r) => r.character_id === A.id).rank).toBe('officer');
    expect((await pool.query('SELECT leader_character_id FROM guilds WHERE id=$1', [G])).rows[0].leader_character_id).toBe(Bu.id);
    expect((await S(A, 'guild/disband', { confirmName: '星詠み団' })).body.error).toBe('not_guild_leader');
    expect((await S(Bu, 'guild/disband', { confirmName: 'ちがう' })).body.error).toBe('confirm_name_mismatch');
    expect((await S(Bu, 'guild/disband', { confirmName: '星詠み団' })).body.ok).toBe(true);
    expect((await pool.query('SELECT count(*)::int n FROM guild_members WHERE guild_id=$1', [G])).rows[0].n).toBe(0);
    expect((await call('GET', `/characters/${A.id}/social`, undefined, A.t)).body.guild).toBeNull();
  });
  it('rankings: level / guild / dungeon, ordered and validated', async () => {
    await pool.query('UPDATE characters SET level=12, exp=5 WHERE id=$1', [C.id]); await pool.query('UPDATE characters SET level=12, exp=9 WHERE id=$1', [Bu.id]);
    const g2 = (await S(C, 'guild/create', { name: '暁の剣' })).body.guildId; expect(g2).toBeTruthy();
    const g3 = (await S(A, 'guild/create', { name: '小さな灯' })).body.guildId; expect(g3).toBeTruthy();
    __clearRankingCache();
    const lv = (await call('GET', '/rankings/level')).body.rows;
    expect(lv[0].id).toBe(Bu.id); expect(lv[1].id).toBe(C.id); expect(lv[1].guild).toBe('暁の剣'); expect(lv[0].rank).toBe(1);
    const gr = (await call('GET', '/rankings/guild')).body.rows; expect(gr[0].name).toBe('暁の剣'); expect(gr[0].score).toBe(12);
    expect((await call('GET', '/rankings/dungeon')).status).toBe(200);
    expect((await call('GET', '/rankings/gold')).body.error).toBe('invalid_ranking');
  });
});
