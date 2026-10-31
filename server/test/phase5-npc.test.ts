import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createGameServer } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { resetDb } from './setup-db.js';
import { npcPos } from '../src/world/maps.js';
const PORT = 25674, B = `http://127.0.0.1:${PORT}/api`;
const { gameServer } = createGameServer({ authLimit: 1000, createLimit: 1000, battleLimit: 10000, actionLimit: 100000, moveLimit: 100000 });
let T = '', CH = '', T2 = '', CH2 = '';
const call = async (method: string, path: string, body?: unknown, token = T) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const user = async (email: string, cls: string, name: string) => {
  await call('POST', '/auth/register', { email, password: 'password123' }, '');
  const t = (await call('POST', '/auth/login', { email, password: 'password123' }, '')).body.token;
  const c = await call('POST', '/characters', { name, class: cls, appearance: { bodyType: 'a', hairStyle: 1, hairColor: 2, skinColor: 0 } }, t);
  return [t, c.body.id];
};
const at = (npc: string, id = CH) => { const p = npcPos('asteria', npc)!; return pool.query(`UPDATE characters SET map_id='asteria',pos_x=$2,pos_y=$3,pos_updated_at=now()-interval '1 hour' WHERE id=$1`, [id, Math.round(p.x), Math.round(p.y + 30)]); };
const give = (item: string, qty: number, id = CH) => pool.query('INSERT INTO inventory(character_id,item_id,quantity) VALUES($1,$2,$3)', [id, item, qty]);
const count = async (item: string, id = CH) => (await pool.query('SELECT coalesce(sum(quantity),0)::int n FROM inventory WHERE character_id=$1 AND item_id=$2', [id, item])).rows[0].n;
const gold = async (id = CH) => Number((await pool.query('SELECT gold FROM characters WHERE id=$1', [id])).rows[0].gold);
const setGold = (g: number, id = CH) => pool.query('UPDATE characters SET gold=$2 WHERE id=$1', [id, g]);
const quest = async (q: string) => (await call('GET', `/characters/${CH}/quests`)).body.find((x: any) => x.id === q);
let n = 0; const rid = () => `req-p5-${++n}-${Date.now()}`;
const winBattle = async () => {
  await pool.query(`UPDATE characters SET map_id='green_meadow',pos_x=112,pos_y=563 WHERE id=$1`, [CH]);
  await pool.query('UPDATE character_stats SET atk=999, agi=99, hp=max_hp WHERE character_id=$1', [CH]);
  const b = (await call('POST', '/battles', { characterId: CH, zone: 'green_meadow', lead: 'slime' })).body;
  let cur = b; while (cur.status === 'active') cur = (await call('POST', `/battles/${b.id}/action`, { turn: cur.turn, command: { type: 'attack', target: cur.combatants.find((c: any) => c.side === 'enemy' && c.hp > 0).id } })).body;
  expect(cur.status).toBe('victory');
  return b.combatants.filter((c: any) => c.side === 'enemy' && c.monsterId === 'slime').length;
};
beforeAll(async () => { await resetDb(); await gameServer.listen(PORT); [T, CH] = await user('s5@example.test', 'warrior', 'Mio'); [T2, CH2] = await user('s6@example.test', 'mage', 'Rin'); });
afterAll(async () => { await gameServer.gracefullyShutdown(false); await pool.end().catch(() => {}); });

describe('PHASE 5 shop', () => {
  it('lists DB prices; buy needs range + gold; replay of a requestId charges once', async () => {
    const list = (await call('GET', '/shops/npc_shop_mira')).body; expect(list.find((i: any) => i.itemId === 'potion_small').price).toBe(10);
    await setGold(100);
    expect((await call('POST', `/characters/${CH}/shop/buy`, { npcId: 'npc_shop_mira', itemId: 'potion_small', qty: 2, requestId: rid() })).body.error).toBe('too_far');
    await at('npc_shop_mira'); const before = await count('potion_small'), r = rid();
    const a = await call('POST', `/characters/${CH}/shop/buy`, { npcId: 'npc_shop_mira', itemId: 'potion_small', qty: 2, requestId: r });
    const b = await call('POST', `/characters/${CH}/shop/buy`, { npcId: 'npc_shop_mira', itemId: 'potion_small', qty: 2, requestId: r });
    expect(a.body.cost).toBe(20); expect(b.body.replayed).toBe(true); expect(await gold()).toBe(80); expect(await count('potion_small')).toBe(before + 2);
    expect((await call('POST', `/characters/${CH}/shop/buy`, { npcId: 'npc_shop_mira', itemId: 'iron_sword', requestId: rid() })).status).toBe(404); // not sold
    expect((await call('POST', `/characters/${CH}/shop/buy`, { npcId: 'npc_shop_mira', itemId: 'potion_small', qty: 0, requestId: rid() })).body.error).toBe('invalid_qty');
    expect((await call('POST', `/characters/${CH}/shop/buy`, { npcId: 'npc_shop_mira', itemId: 'potion_small', qty: 9, requestId: rid() })).body.error).toBe('not_enough_gold');
    expect(await gold()).toBe(80);
  });
  it('parallel buys of the last affordable item: only one succeeds', async () => {
    await setGold(10); const before = await count('potion_small');
    const rs = await Promise.all([0, 1, 2, 3].map(() => call('POST', `/characters/${CH}/shop/buy`, { npcId: 'npc_shop_mira', itemId: 'potion_small', requestId: rid() })));
    expect(rs.filter((r) => r.status === 200).length).toBe(1); expect(await gold()).toBe(0); expect(await count('potion_small')).toBe(before + 1);
  });
  it('sell: sell_price from DB, equipped / other players items refused, replay pays once', async () => {
    const inv = (await call('GET', `/characters/${CH}/items`)).body.items;
    const sword = inv.find((i: any) => i.itemId === 'wooden_sword');
    expect((await call('POST', `/characters/${CH}/shop/sell`, { npcId: 'npc_shop_mira', inventoryId: sword.id, requestId: rid() })).body.error).toBe('equipped');
    const other = (await call('GET', `/characters/${CH2}/items`, undefined, T2)).body.items[0];
    expect((await call('POST', `/characters/${CH}/shop/sell`, { npcId: 'npc_shop_mira', inventoryId: other.id, requestId: rid() })).status).toBe(404);
    const pot = inv.find((i: any) => i.itemId === 'potion_small'), r = rid(), g0 = await gold(), c0 = await count('potion_small');
    await call('POST', `/characters/${CH}/shop/sell`, { npcId: 'npc_shop_mira', inventoryId: pot.id, qty: 1, requestId: r });
    expect((await call('POST', `/characters/${CH}/shop/sell`, { npcId: 'npc_shop_mira', inventoryId: pot.id, qty: 1, requestId: r })).body.replayed).toBe(true);
    expect(await gold()).toBe(g0 + 4); expect(await count('potion_small')).toBe(c0 - 1);
  });
});
describe('PHASE 5 inn', () => {
  it('costs 10 x level, full heal, refuses when full or too far or broke', async () => {
    await pool.query('UPDATE characters SET level=3 WHERE id=$1', [CH]);
    await pool.query('UPDATE character_stats SET hp=1, mp=0 WHERE character_id=$1', [CH]); await setGold(100);
    expect((await call('POST', `/characters/${CH}/inn`, { requestId: rid() })).body.error).toBe('too_far');
    await at('npc_inn_hana'); const r = rid();
    const a = await call('POST', `/characters/${CH}/inn`, { requestId: r }); expect(a.body.cost).toBe(30);
    expect((await call('POST', `/characters/${CH}/inn`, { requestId: r })).body.replayed).toBe(true);
    const s = (await pool.query('SELECT hp,max_hp,mp,max_mp FROM character_stats WHERE character_id=$1', [CH])).rows[0];
    expect(s.hp).toBe(s.max_hp); expect(s.mp).toBe(s.max_mp); expect(await gold()).toBe(70);
    expect((await call('POST', `/characters/${CH}/inn`, { requestId: rid() })).body.error).toBe('already_full');
    await pool.query('UPDATE character_stats SET hp=1 WHERE character_id=$1', [CH]); await setGold(5);
    expect((await call('POST', `/characters/${CH}/inn`, { requestId: rid() })).body.error).toBe('not_enough_gold');
    await pool.query('UPDATE characters SET level=1 WHERE id=$1', [CH]);
  });
});
describe('PHASE 5 quests', () => {
  it('lists 4 quests (hunt / gather / delivery / daily) as available', async () => {
    const qs = (await call('GET', `/characters/${CH}/quests`)).body;
    expect(qs.map((q: any) => q.category).sort()).toEqual(['daily', 'delivery', 'gather', 'hunt']);
    expect(qs.every((q: any) => q.state === 'available')).toBe(true);
  });
  it('hunt: accept at NPC, kills counted from server battles, reward exactly once', async () => {
    expect((await call('POST', `/characters/${CH}/quests/q_hunt_slime/accept`, { requestId: rid() })).body.error).toBe('too_far');
    await at('npc_chief_bram');
    expect((await call('POST', `/characters/${CH}/quests/q_hunt_slime/accept`, { requestId: rid() })).body.state).toBe('active');
    expect((await call('POST', `/characters/${CH}/quests/q_hunt_slime/accept`, { requestId: rid() })).body.error).toBe('quest_active');
    expect((await call('POST', `/characters/${CH}/quests/q_hunt_slime/complete`, { requestId: rid() })).body.error).toBe('quest_incomplete');
    let k = 0; while (k < 3) k += await winBattle();
    expect((await quest('q_hunt_slime')).objectives[0].have).toBe(3); expect((await quest('q_hunt_slime')).ready).toBe(true);
    await at('npc_chief_bram'); const g0 = await gold();
    const rs = await Promise.all([0, 1, 2].map(() => call('POST', `/characters/${CH}/quests/q_hunt_slime/complete`, { requestId: rid() })));
    expect(rs.filter((r) => r.status === 200).length).toBe(1);
    expect(rs.filter((r) => r.status !== 200).every((r) => r.body.error === 'already_rewarded')).toBe(true);
    expect(await gold()).toBe(g0 + 60);
    expect((await pool.query(`SELECT count(*)::int n FROM transactions WHERE character_id=$1 AND kind='quest_reward'`, [CH])).rows[0].n).toBe(1);
    expect((await quest('q_hunt_slime')).state).toBe('rewarded');
    expect((await call('POST', `/characters/${CH}/quests/q_hunt_slime/accept`, { requestId: rid() })).body.error).toBe('quest_done');
  });
  it('gather: collect items consumed on turn-in', async () => {
    await at('npc_shop_mira');
    await call('POST', `/characters/${CH}/quests/q_gather_herb/accept`, { requestId: rid() });
    await give('herb', 2);
    expect((await call('POST', `/characters/${CH}/quests/q_gather_herb/complete`, { requestId: rid() })).body.error).toBe('quest_incomplete');
    expect(await count('herb')).toBe(2); // rollback kept the herbs
    await give('herb', 2); const a0 = await count('antidote');
    expect((await call('POST', `/characters/${CH}/quests/q_gather_herb/complete`, { requestId: rid() })).status).toBe(200);
    expect(await count('herb')).toBe(1); expect(await count('antidote')).toBe(a0 + 1);
  });
  it('delivery: letter given on accept, cannot be sold, turned in at the smith', async () => {
    await at('npc_chief_bram');
    await call('POST', `/characters/${CH}/quests/q_deliver_letter/accept`, { requestId: rid() });
    expect(await count('chief_letter')).toBe(1);
    expect((await call('POST', `/characters/${CH}/quests/q_deliver_letter/complete`, { requestId: rid() })).body.error).toBe('too_far'); // must go to the smith
    await at('npc_shop_mira');
    const letter = (await call('GET', `/characters/${CH}/items`)).body.items.find((i: any) => i.itemId === 'chief_letter');
    expect((await call('POST', `/characters/${CH}/shop/sell`, { npcId: 'npc_shop_mira', inventoryId: letter.id, requestId: rid() })).body.error).toBe('cannot_sell');
    await at('npc_smith_gord');
    expect((await call('POST', `/characters/${CH}/quests/q_deliver_letter/complete`, { requestId: rid() })).status).toBe(200);
    expect(await count('chief_letter')).toBe(0);
  });
  it('daily: once per JST day, available again the next day with a new reward key', async () => {
    await at('npc_guard_leon');
    await call('POST', `/characters/${CH}/quests/q_daily_hunt/accept`, { requestId: rid() });
    await pool.query(`UPDATE character_quests SET progress='{"kill:slime":5}' WHERE character_id=$1 AND quest_id='q_daily_hunt'`, [CH]);
    expect((await call('POST', `/characters/${CH}/quests/q_daily_hunt/complete`, { requestId: rid() })).status).toBe(200);
    expect((await quest('q_daily_hunt')).state).toBe('done_today');
    expect((await call('POST', `/characters/${CH}/quests/q_daily_hunt/accept`, { requestId: rid() })).body.error).toBe('quest_done');
    await pool.query(`UPDATE character_quests SET rewarded_at=now()-interval '1 day' WHERE character_id=$1 AND quest_id='q_daily_hunt'`, [CH]);
    expect((await quest('q_daily_hunt')).state).toBe('available');
    expect((await call('POST', `/characters/${CH}/quests/q_daily_hunt/accept`, { requestId: rid() })).body.state).toBe('active');
    await pool.query(`UPDATE character_quests SET progress='{"kill:slime":5}' WHERE character_id=$1 AND quest_id='q_daily_hunt'`, [CH]);
    expect((await call('POST', `/characters/${CH}/quests/q_daily_hunt/complete`, { requestId: rid() })).status).toBe(200);
    const keys = (await pool.query(`SELECT idempotency_key k FROM transactions WHERE character_id=$1 AND kind='quest_reward' AND ref_id='q_daily_hunt' ORDER BY id`, [CH])).rows.map((r) => r.k);
    expect(keys).toEqual(['quest:q_daily_hunt:1', 'quest:q_daily_hunt:2']);
  });
});
