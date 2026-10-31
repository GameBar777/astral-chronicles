import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createGameServer } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { __setRng } from '../src/services/battle.js';
import { resetDb } from './setup-db.js';
const PORT = 25672, B = `http://127.0.0.1:${PORT}/api`;
const { gameServer } = createGameServer({ authLimit: 1000, createLimit: 1000, battleLimit: 10000 });
const call = async (method: string, path: string, body?: unknown, token = T) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
let T = '', T2 = '', CH = '', CH2 = '';
const charRow = async (id = CH) => (await pool.query('SELECT c.level,c.exp,c.gold,s.hp,s.max_hp,s.mp,s.atk FROM characters c JOIN character_stats s ON s.character_id=c.id WHERE c.id=$1', [id])).rows[0];
const potions = async (id = CH) => (await pool.query(`SELECT coalesce(sum(quantity),0)::int n FROM inventory WHERE character_id=$1 AND item_id='potion_small'`, [id])).rows[0].n;
const user = async (email: string, cls: string) => {
  await call('POST', '/auth/register', { email, password: 'password123' }, '');
  const t = (await call('POST', '/auth/login', { email, password: 'password123' }, '')).body.token;
  const c = await call('POST', '/characters', { name: cls === 'warrior' ? 'Garo' : 'Mina', class: cls, appearance: { bodyType: 'a', hairStyle: 1, hairColor: 2, skinColor: 0 } }, t);
  return [t, c.body.id];
};
/** Win quickly: boost ATK so one hit KOs; rng 0.5 => 1 enemy chosen deterministically. */
async function quickWin(id = CH) {
  await pool.query('UPDATE character_stats SET atk=999, agi=99 WHERE character_id=$1', [id]);
  __setRng(() => 0.1); // spawn roll => first monster (horn_rabbit sorted? we pass lead), n=1
  const b = (await call('POST', '/battles', { characterId: id, zone: 'green_meadow', lead: 'slime' })).body;
  let cur = b;
  while (cur.status === 'active') cur = (await call('POST', `/battles/${b.id}/action`, { turn: cur.turn, command: { type: 'attack', target: cur.combatants.find((c: any) => c.side === 'enemy' && c.hp > 0).id } })).body;
  return cur;
}
beforeAll(async () => { await resetDb(); await gameServer.listen(PORT); [T, CH] = await user('war@example.test', 'warrior'); [T2, CH2] = await user('mag@example.test', 'mage'); });
afterAll(async () => { __setRng(Math.random); await gameServer.gracefullyShutdown(false); await pool.end().catch(() => {}); });

describe('PHASE 3 battle API (server-authoritative)', () => {
  it('master data seeded: 5 meadow monsters, drops, starter potions x3', async () => {
    expect((await pool.query(`SELECT count(*)::int n FROM monster_definitions WHERE 'green_meadow'=ANY(spawn_areas)`)).rows[0].n).toBe(5);
    expect(await potions()).toBe(3);
    expect((await call('GET', `/characters/${CH}/inventory`)).body).toEqual([{ item_id: 'potion_small', name: 'やくそう', category: 'consumable', qty: 3 }]);
  });
  it('start: validates zone / ownership; enemies 1-3; rewards hidden from client', async () => {
    expect((await call('POST', '/battles', { characterId: CH, zone: 'nowhere' })).body.error).toBe('invalid_zone');
    expect((await call('POST', '/battles', { characterId: CH, zone: 'green_meadow' }, T2)).status).toBe(404);
    expect((await call('POST', '/battles', { characterId: 'not-a-uuid', zone: 'green_meadow' })).status).toBe(404);
    __setRng(() => 0.99);
    const b = await call('POST', '/battles', { characterId: CH, zone: 'green_meadow', lead: 'mushroom' });
    expect(b.status).toBe(201); const en = b.body.combatants.filter((c: any) => c.side === 'enemy');
    expect(en.length).toBe(3); expect(en[0].monsterId).toBe('mushroom');
    expect(JSON.stringify(b.body)).not.toContain('reward');
    // resume: same active battle returned (disconnect/reload) and GET shows it
    const again = await call('POST', '/battles', { characterId: CH, zone: 'green_meadow' });
    expect(again.body.id).toBe(b.body.id); expect(again.body.resumed).toBe(true);
    expect((await call('GET', `/characters/${CH}/battle`)).body.battle.id).toBe(b.body.id);
    // flee (rng 0.01 succeeds) -> no rewards, battle closed
    __setRng(() => 0.01);
    const f = await call('POST', `/battles/${b.body.id}/action`, { turn: 1, command: { type: 'flee' } });
    expect(f.body.status).toBe('fled'); expect(f.body.rewards).toBeNull();
    expect((await call('GET', `/characters/${CH}/battle`)).body.battle).toBeNull();
    expect((await call('POST', `/battles/${b.body.id}/action`, { turn: 2, command: { type: 'attack', target: 'e0' } })).body.error).toBe('battle_over');
  });
  it('stale / duplicate turn rejected (409), invalid commands 400, other user 404', async () => {
    __setRng(() => 0.5);
    const b = (await call('POST', '/battles', { characterId: CH, zone: 'green_meadow', lead: 'goblin' })).body;
    expect((await call('POST', `/battles/${b.id}/action`, { turn: 5, command: { type: 'defend' } })).body.error).toBe('stale_turn');
    expect((await call('POST', `/battles/${b.id}/action`, { turn: 1, command: { type: 'attack', target: 'p0' } })).body.error).toBe('invalid_target');
    expect((await call('POST', `/battles/${b.id}/action`, { turn: 1, command: { type: 'skill', skillId: 'mage_fire', target: 'e0' } })).body.error).toBe('unknown_skill');
    expect((await call('POST', `/battles/${b.id}/action`, { turn: 1, command: { type: 'item', itemId: 'antidote' } })).body.error).toBe('no_item');
    expect((await call('POST', `/battles/${b.id}/action`, { turn: 1, command: { type: 'defend' } }, T2)).status).toBe(404);
    expect((await call('POST', `/battles/${b.id}/action`, { turn: '1', command: { type: 'defend' } })).status).toBe(400);
    // parallel duplicate submissions of the same turn: exactly one applies
    const rs = await Promise.all([1, 2, 3].map(() => call('POST', `/battles/${b.id}/action`, { turn: 1, command: { type: 'defend' } })));
    expect(rs.filter((r) => r.status === 200).length).toBe(1); expect(rs.filter((r) => r.body.error === 'stale_turn').length).toBe(2);
    // HP persisted only at battle end; state persisted every turn
    const st = (await pool.query('SELECT state FROM battle_logs WHERE id=$1', [b.id])).rows[0].state;
    expect(st.turn).toBe(2); expect(st.log.length).toBeGreaterThan(1);
    // item use consumes inventory atomically with the turn
    const before = await potions();
    const r = await call('POST', `/battles/${b.id}/action`, { turn: 2, command: { type: 'item', itemId: 'potion_small' } });
    expect(r.status).toBe(200); expect(await potions()).toBe(before - 1);
    __setRng(() => 0.01); await call('POST', `/battles/${b.id}/action`, { turn: 3, command: { type: 'flee' } });
  });
  it('victory grants EXP/Gold/drops exactly once; level up updates stats', async () => {
    await pool.query('UPDATE characters SET exp=95 WHERE id=$1', [CH]);
    const before = await charRow();
    const end = await quickWin();
    expect(end.status).toBe('victory');
    expect(end.rewards.exp).toBe(8); expect(end.rewards.gold).toBe(Math.floor(5 * 0.96)); // ±5% variance, rng 0.1
    expect(end.rewards.drops.map((d: any) => d.itemId)).toEqual(['slime_jelly', 'potion_small']); // rng 0.1 < both rates
    expect(end.levelUp.from).toBe(1); expect(end.levelUp.to).toBe(2); expect(end.levelUp.statDiff.maxHp).toBeGreaterThan(0);
    const after = await charRow();
    expect(after.level).toBe(2); expect(Number(after.exp)).toBe(3);
    expect(after.gold - before.gold).toBe(end.rewards.gold); expect(after.hp).toBe(after.max_hp);
    // replay the final turn / any turn => rejected, no extra gold
    const replay = await call('POST', `/battles/${end.id}/action`, { turn: end.turn - 1, command: { type: 'attack', target: 'e0' } });
    expect(replay.status).toBe(409); expect((await charRow()).gold).toBe(after.gold);
    expect((await pool.query(`SELECT count(*)::int n FROM transactions WHERE idempotency_key=$1`, [`battle:${end.id}`])).rows[0].n).toBe(1);
    const row = (await pool.query('SELECT result, rewards_committed FROM battle_logs WHERE id=$1', [end.id])).rows[0];
    expect(row).toEqual({ result: 'victory', rewards_committed: true });
  });
  it('reward commit is idempotent even if called twice directly (DB guard)', async () => {
    const { commitRewards } = await import('../src/services/battle.js');
    const id = (await pool.query(`SELECT id, state FROM battle_logs WHERE character_id=$1 AND result='victory' LIMIT 1`, [CH])).rows[0];
    const c = await pool.connect(); const ch = (await c.query('SELECT c.*, c.id FROM characters c WHERE id=$1', [CH])).rows[0];
    await c.query(`UPDATE battle_logs SET rewards_committed=false WHERE id=$1`, [id.id]); // simulate flag lost
    const r = await commitRewards(c, id.id, ch, id.state); c.release();
    expect(r.rewards).toBeNull(); // transactions UNIQUE key still blocks the second grant
  });
  it('defeat: HP set to 30%, no rewards', async () => {
    await pool.query('UPDATE character_stats SET hp=1, def=0, agi=1 WHERE character_id=$1', [CH2]);
    __setRng(() => 0.5);
    const b = (await call('POST', '/battles', { characterId: CH2, zone: 'green_meadow', lead: 'wild_dog' }, T2)).body;
    const r = await call('POST', `/battles/${b.id}/action`, { turn: 1, command: { type: 'defend' } }, T2);
    expect(r.body.status).toBe('defeat'); expect(r.body.rewards).toBeNull();
    const c = await charRow(CH2); expect(c.hp).toBe(Math.floor(c.max_hp * 0.3)); expect(Number(c.gold)).toBe(0);
  });
  it('disconnect mid-battle: state survives a server-side restart of the request (DB is source of truth)', async () => {
    __setRng(() => 0.5);
    await pool.query('UPDATE character_stats SET atk=5 WHERE character_id=$1', [CH]);
    const b = (await call('POST', '/battles', { characterId: CH, zone: 'green_meadow', lead: 'goblin' })).body;
    await call('POST', `/battles/${b.id}/action`, { turn: 1, command: { type: 'attack', target: 'e0' } });
    const resumed = (await call('GET', `/characters/${CH}/battle`)).body.battle;
    expect(resumed.turn).toBe(2); expect(resumed.combatants.find((c: any) => c.id === 'e0').hp).toBeLessThan(42);
    // stale (>30min) battles are aborted without rewards when a new one starts
    await pool.query(`UPDATE battle_logs SET updated_at=now()-interval '31 minutes' WHERE id=$1`, [b.id]);
    const nb = (await call('POST', '/battles', { characterId: CH, zone: 'green_meadow' })).body;
    expect(nb.id).not.toBe(b.id);
    expect((await pool.query('SELECT result, rewards_committed FROM battle_logs WHERE id=$1', [b.id])).rows[0]).toEqual({ result: 'aborted', rewards_committed: false });
  });
});
