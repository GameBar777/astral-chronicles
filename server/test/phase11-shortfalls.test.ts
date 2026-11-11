import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createGameServer } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { resetDb } from './setup-db.js';
import { addGuildExp } from '../src/services/social.js';
import { wearEquipment } from '../src/services/inventory.js';
const PORT = 25682, API = `http://127.0.0.1:${PORT}/api`;
const { gameServer } = createGameServer({ authLimit: 1000, createLimit: 1000, actionLimit: 10000, battleLimit: 10000 } as any);
const call = async (method: string, path: string, body?: unknown, token = '') => {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
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
const G = (u: any, path: string) => call('GET', `/characters/${u.id}/${path}`, undefined, u.t);
const gold = async (id: string) => Number((await pool.query('SELECT gold FROM characters WHERE id=$1', [id])).rows[0].gold);
const setGold = (id: string, g: number) => pool.query('UPDATE characters SET gold=$2 WHERE id=$1', [id, g]);
const give = async (id: string, itemId: string, qty: number) =>
  (await pool.query('INSERT INTO inventory(character_id,item_id,quantity) VALUES($1,$2,$3) RETURNING id', [id, itemId, qty])).rows[0].id as string;
const count = async (id: string, itemId: string) => Number((await pool.query('SELECT coalesce(sum(quantity),0)::int n FROM inventory WHERE character_id=$1 AND item_id=$2', [id, itemId])).rows[0].n);
let A: any, B: any, C: any;
beforeAll(async () => {
  await resetDb(); await gameServer.listen(PORT);
  A = await user('a11@example.com', '短期A'); B = await user('b11@example.com', '短期B'); C = await user('c11@example.com', '短期C');
});
afterAll(async () => { await gameServer.gracefullyShutdown(false).catch(() => {}); await pool.end(); });

describe('equipment durability and repair', () => {
  it('starter gear has durability; wear drops it; repair costs gold and is idempotent', async () => {
    const inv = await G(A, 'items');
    const sword = inv.body.items.find((i: any) => i.itemId === 'wooden_sword');
    expect(sword.maxDurability).toBe(50);
    expect(sword.durability).toBe(50);
    expect(sword.equipped).toBe('weapon');
    const c = await pool.connect();
    try { await c.query('BEGIN'); await wearEquipment(c, A.id); await c.query('COMMIT'); }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    const worn = (await G(A, 'items')).body.items.find((i: any) => i.id === sword.id);
    expect(worn.durability).toBe(49);
    await setGold(A.id, 100);
    const r1 = await S(A, 'repair', { inventoryId: sword.id, requestId: 'repair-1' });
    expect(r1.status).toBe(200); expect(r1.body.durability).toBe(50); expect(r1.body.gold).toBe(2);
    expect(await gold(A.id)).toBe(98);
    const r2 = await S(A, 'repair', { inventoryId: sword.id, requestId: 'repair-1' });
    expect(r2.body.replayed).toBe(true); expect(await gold(A.id)).toBe(98); // idempotent, no second charge
    const full = await S(A, 'repair', { inventoryId: sword.id, requestId: 'repair-2' });
    expect(full.body.error).toBe('already_repaired');
  });
  it('a broken item is unequipped, grants no bonus, and cannot be re-equipped until repaired', async () => {
    const inv = await G(A, 'items');
    const sword = inv.body.items.find((i: any) => i.itemId === 'wooden_sword');
    const bonusBefore = inv.body.stats.bonus.atk;
    expect(bonusBefore).toBeGreaterThan(0);
    await pool.query('UPDATE inventory SET durability=0 WHERE id=$1', [sword.id]);
    const c = await pool.connect();
    try { await c.query('BEGIN'); await wearEquipment(c, A.id); await c.query('COMMIT'); }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    const after = await G(A, 'items');
    const s2 = after.body.items.find((i: any) => i.id === sword.id);
    expect(s2.equipped).toBeFalsy();
    expect(after.body.stats.bonus.atk).toBe(0);
    expect((await S(A, 'equip', { inventoryId: sword.id })).body.error).toBe('broken');
    await setGold(A.id, 200);
    const fix = await S(A, 'repair', { inventoryId: sword.id, requestId: 'repair-broken' });
    expect(fix.body.durability).toBe(50); expect(fix.body.gold).toBe(100);
    expect((await S(A, 'equip', { inventoryId: sword.id })).body.slot).toBe('weapon');
  });
});

describe('guild levels and storage', () => {
  it('members can deposit; only officers and the leader can withdraw; exp levels the guild', async () => {
    expect((await S(A, 'guild/create', { name: '倉庫組合' })).status).toBe(200);
    await S(A, 'guild/invite', { name: '短期B' });
    const inv = (await G(B, 'social')).body.invites.find((i: any) => i.kind === 'guild');
    expect((await S(B, 'guild/accept', { guildId: inv.id ?? inv.scope_id })).status).toBe(200);
    await give(B.id, 'herb', 5);
    expect((await S(B, 'guild/deposit', { itemId: 'herb', qty: 3 })).status).toBe(200);
    expect(await count(B.id, 'herb')).toBe(2);
    const st = await G(B, 'guild/storage');
    expect(st.body.level).toBe(1); expect(st.body.items[0]).toMatchObject({ itemId: 'herb', quantity: 3 });
    expect((await S(B, 'guild/withdraw', { itemId: 'herb', qty: 1 })).body.error).toBe('not_guild_officer');
    expect((await S(A, 'guild/withdraw', { itemId: 'herb', qty: 1 })).status).toBe(200);
    expect(await count(A.id, 'herb')).toBe(1);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await addGuildExp(c, A.id, 1000);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    const st2 = await G(A, 'guild/storage');
    expect(st2.body.level).toBe(2); expect(st2.body.exp).toBe(1000);
  });
  it('claiming a dungeon clear awards guild experience', async () => {
    const inst = (await pool.query(`INSERT INTO dungeon_instances(dungeon_id,status,expires_at,leader_character_id,state)
      VALUES('ancient_ruins','cleared', now() + interval '1 hour', $1, '{"gates":{}}') RETURNING id`, [A.id])).rows[0];
    await pool.query('INSERT INTO dungeon_members(instance_id,character_id) VALUES($1,$2)', [inst.id, A.id]);
    const before = (await G(A, 'guild/storage')).body.exp;
    const r = await S(A, 'dungeon/claim');
    expect(r.status).toBe(200);
    const after = (await G(A, 'guild/storage')).body.exp;
    expect(after).toBe(before + 150);
  });
});

describe('market price history', () => {
  it('records unit price on sale and serves recent history', async () => {
    await pool.query(`UPDATE characters SET map_id='asteria' WHERE id=ANY($1)`, [[A.id, C.id]]);
    const herb = await give(C.id, 'herb', 6);
    const listed = await S(C, 'market/list', { inventoryId: herb, qty: 2, price: 80, hours: 24, requestId: rid() });
    expect(listed.status).toBe(200);
    await setGold(A.id, 500);
    const buy = await S(A, 'market/buy', { listingId: listed.body.listingId, expectedPrice: 80, requestId: rid() });
    expect(buy.status).toBe(200);
    const h = await call('GET', '/market/history/herb', undefined, A.t);
    expect(h.status).toBe(200);
    expect(h.body.avg).toBe(40); // 80G for 2 units
    expect(h.body.sales[0].quantity).toBe(2);
    expect(h.body.sales[0].unitPrice).toBe(40);
    const empty = await call('GET', '/market/history/iron_ore', undefined, A.t);
    expect(empty.body.sales).toEqual([]); expect(empty.body.avg).toBeNull();
  });

  it('crossed concurrent buys (A buys B, B buys A) both succeed without deadlock', async () => {
    await pool.query(`UPDATE characters SET map_id='asteria' WHERE id=ANY($1)`, [[A.id, B.id]]);
    await setGold(A.id, 1000); await setGold(B.id, 1000);
    const aHerb = await give(A.id, 'herb', 3);
    const bHerb = await give(B.id, 'herb', 3);
    const lA = await S(A, 'market/list', { inventoryId: aHerb, qty: 1, price: 40, hours: 1, requestId: rid() });
    const lB = await S(B, 'market/list', { inventoryId: bHerb, qty: 1, price: 50, hours: 1, requestId: rid() });
    expect(lA.status).toBe(200); expect(lB.status).toBe(200);
    const [buyA, buyB] = await Promise.all([
      S(A, 'market/buy', { listingId: lB.body.listingId, expectedPrice: 50, requestId: rid() }),
      S(B, 'market/buy', { listingId: lA.body.listingId, expectedPrice: 40, requestId: rid() }),
    ]);
    expect(buyA.status).toBe(200);
    expect(buyB.status).toBe(200);
    expect(buyA.body.error).toBeUndefined();
    expect(buyB.body.error).toBeUndefined();
  });
});
