import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client, type Room } from 'colyseus.js';
process.env.DUNGEON_TURN_MS = '800';
const { createGameServer } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { resetDb } = await import('./setup-db.js');
const { sweepDungeons } = await import('../src/services/dungeon.js');
const PORT = 25678, B = `http://127.0.0.1:${PORT}/api`, WS = `ws://127.0.0.1:${PORT}`;
const { gameServer } = createGameServer({ authLimit: 1000, createLimit: 1000, battleLimit: 10000 } as any);
const call = async (method: string, path: string, body?: unknown, token = '') => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const user = async (email: string, name: string) => {
  await call('POST', '/auth/register', { email, password: 'password123' });
  const t = (await call('POST', '/auth/login', { email, password: 'password123' })).body.token;
  const c = await call('POST', '/characters', { name, class: 'warrior', appearance: { bodyType: 'a', hairStyle: 1, hairColor: 2, skinColor: 0 } }, t);
  return { t, id: c.body.id as string };
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 4000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timeout'); await wait(20); } };
const S = (u: any, path: string, body: any = {}) => call('POST', `/characters/${u.id}/${path}`, body, u.t);
const D = (u: any) => call('GET', `/characters/${u.id}/dungeon`, undefined, u.t).then((r) => r.body.dungeon);
const toEntrance = (id: string) => pool.query(`UPDATE characters SET map_id='green_meadow', pos_x=1424, pos_y=560 WHERE id=$1`, [id]);
const stats = (id: string, atk: number, hp = 999) => pool.query('UPDATE character_stats SET atk=$2, hp=$3, max_hp=$3, def=40 WHERE character_id=$1', [id, atk, hp]);
const gold = async (id: string) => Number((await pool.query('SELECT gold FROM characters WHERE id=$1', [id])).rows[0].gold);
let A: any, Bu: any, C: any; const rooms: Room[] = [];
const box = (r: Room) => { const b: any = { battle: [], wait: [], dungeon: [] }; r.onMessage('battle', (m) => b.battle.push(m)); r.onMessage('battle_wait', (m) => b.wait.push(m)); r.onMessage('dungeon', (m) => b.dungeon.push(m)); r.onMessage('*', () => {}); return b; };
const joinWorld = async (u: any) => { const r = await new Client(WS).joinOrCreate('world', { token: u.t, characterId: u.id, mapId: 'green_meadow' }); r.onMessage('*', () => {}); rooms.push(r); return r; };
const joinDg = async (u: any, instanceId: string, ready = true) => { const r = await new Client(WS).joinOrCreate('dungeon', { token: u.t, characterId: u.id, instanceId }); rooms.push(r); await wait(50); if (ready) r.send('battle_ready'); await wait(30); return r; };
const arm = async (...rs: Room[]) => { for (const r of rs) r.send('battle_ready'); await wait(40); };
beforeAll(async () => {
  await resetDb(); await gameServer.listen(PORT);
  A = await user('a8@example.com', '遺跡A'); Bu = await user('b8@example.com', '遺跡B'); C = await user('c8@example.com', '遺跡C');
  for (const u of [A, Bu, C]) await toEntrance(u.id);
});
afterAll(async () => { for (const r of rooms) await Promise.race([r.leave().catch(() => {}), wait(300)]); await Promise.race([gameServer.gracefullyShutdown(false), wait(2000)]); await pool.end(); });

/** both submit (or only `who`), until the battle ends; returns last views */
async function fight(battleId: string, us: any[]) {
  let last: any; for (let i = 0; i < 40; i++) {
    const cur = (await call('GET', `/characters/${us[0].id}/battle`, undefined, us[0].t)).body.battle; if (!cur) return last;
    const rs = await Promise.all(us.map((u) => { const me = cur.combatants.find((c: any) => c.characterId === u.id); const tgt = cur.combatants.find((c: any) => c.side === 'enemy' && c.hp > 0);
      return me.hp > 0 ? call('POST', `/battles/${battleId}/action`, { turn: cur.turn, command: { type: 'attack', target: tgt.id } }, u.t) : null; }));
    last = rs.filter(Boolean).map((r: any) => r.body); if (last.some((b: any) => b.status !== 'active' && !b.waiting)) return last;
  }
  throw new Error('battle did not end');
}
describe('PHASE 8 instance dungeon', () => {
  let ra: Room, rb: Room, ba: any, bb: any, inst: string, battle1: string;
  it('party entry: only the leader can enter; online members on the entry map are brought in together', async () => {
    await joinWorld(A); await joinWorld(Bu);
    const inv = await S(A, 'party/invite', { name: '遺跡B' }); await S(Bu, 'party/accept', { partyId: inv.body.partyId });
    expect((await S(Bu, 'dungeon/enter', { dungeonId: 'ancient_ruins' })).body.error).toBe('not_leader');
    expect((await S(A, 'dungeon/enter', { dungeonId: 'nope' })).body.error).toBe('invalid_dungeon');
    await pool.query('UPDATE characters SET pos_x=200 WHERE id=$1', [A.id]);
    expect((await S(A, 'dungeon/enter', { dungeonId: 'ancient_ruins' })).body.error).toBe('too_far');
    await toEntrance(A.id);
    const r = await S(A, 'dungeon/enter', { dungeonId: 'ancient_ruins' }); expect(r.status).toBe(201);
    inst = r.body.dungeon.id;
    expect(r.body.dungeon.members.map((m: any) => m.id).sort()).toEqual([A.id, Bu.id].sort());
    expect((await S(A, 'dungeon/enter', { dungeonId: 'ancient_ruins' })).body.error).toBe('already_in_dungeon');
    expect((await D(Bu)).id).toBe(inst);
    expect((await call('POST', '/battles', { characterId: A.id, zone: 'green_meadow' }, A.t)).body.error).toBe('in_dungeon');
    // solo entry for a character without a party
    const c = await S(C, 'dungeon/enter', { dungeonId: 'ancient_ruins' }); expect(c.status).toBe(201); expect(c.body.dungeon.members).toHaveLength(1);
    expect(c.body.dungeon.id).not.toBe(inst);
  });
  it('instance channel: only members can join', async () => {
    await expect(joinDg(C, inst)).rejects.toBeTruthy();
    ra = await joinDg(A, inst); rb = await joinDg(Bu, inst); ba = box(ra); bb = box(rb);
  });
  it('chest / stairs locked until the floor guard is defeated', async () => {
    expect((await S(A, 'dungeon/chest')).body.error).toBe('gate_not_cleared');
    expect((await S(A, 'dungeon/next')).body.error).toBe('gate_not_cleared');
  });
  it('party battle: turn waits for every member, pushes to both, leave blocked mid-battle, every member rewarded once', async () => {
    await stats(A.id, 300); await stats(Bu.id, 300);
    const b = await S(A, 'dungeon/battle'); expect(b.status).toBe(201); battle1 = b.body.id;
    expect(b.body.combatants.filter((c: any) => c.side === 'player')).toHaveLength(2);
    await until(() => bb.battle.length >= 1); expect(bb.battle[0].id).toBe(battle1);
    expect((await S(Bu, 'dungeon/battle')).body.resumed).toBe(true);
    expect((await S(A, 'dungeon/leave')).body.error).toBe('in_battle');
    const e0 = b.body.combatants.find((c: any) => c.side === 'enemy').id;
    const w = await call('POST', `/battles/${battle1}/action`, { turn: 1, command: { type: 'attack', target: e0 } }, A.t);
    expect(w.body.waiting).toBe(true); expect(w.body.turn).toBe(1);
    await until(() => bb.wait.length >= 1);
    expect((await call('POST', `/battles/${battle1}/action`, { turn: 1, command: { type: 'attack', target: e0 } }, A.t)).body.turn).toBe(1); // resubmit replaces own pending command
    const r = await call('POST', `/battles/${battle1}/action`, { turn: 1, command: { type: 'attack', target: e0 } }, Bu.t);
    expect(r.body.turn).toBe(2); expect(r.body.waiting).toBeUndefined();
    await until(() => ba.battle.some((m: any) => m.turn === 2));
    await fight(battle1, [A, Bu]);
    const row = (await pool.query('SELECT result, rewards_committed FROM battle_logs WHERE id=$1', [battle1])).rows[0];
    expect(row).toEqual({ result: 'victory', rewards_committed: true });
    const txs = (await pool.query(`SELECT character_id FROM transactions WHERE idempotency_key=$1`, [`battle:${battle1}`])).rows.map((x) => x.character_id).sort();
    expect(txs).toEqual([A.id, Bu.id].sort());
    expect((await D(A)).gateCleared).toBe(true);
    expect((await S(A, 'dungeon/battle')).body.error).toBe('already_cleared');
  });
  it('chest: each member once; concurrent double-claim gives exactly one success', async () => {
    const g0 = await gold(A.id);
    const rs = await Promise.all([1, 2, 3, 4].map(() => S(A, 'dungeon/chest')));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.body.error === 'already_claimed')).toHaveLength(3);
    expect(await gold(A.id)).toBe(g0 + 40);
    expect((await S(Bu, 'dungeon/chest')).status).toBe(200);
    expect((await pool.query(`SELECT count(*)::int n FROM transactions WHERE idempotency_key=$1`, [`dungeon:${inst}:chest:1`])).rows[0].n).toBe(2);
  });
  it('stairs: leader only; floor change pushed to members', async () => {
    expect((await S(Bu, 'dungeon/next')).body.error).toBe('not_leader');
    const n = bb.dungeon.length; const r = await S(A, 'dungeon/next'); expect(r.body.floor).toBe(2);
    await until(() => bb.dungeon.length > n); expect((await D(Bu)).floor).toBe(2);
  });
  it('turn deadline: an idle member defaults to defend; a disconnected member does not block the turn', async () => {
    await pool.query('UPDATE character_stats SET atk=1 WHERE character_id = ANY($1)', [[A.id, Bu.id]]); // weak party keeps the battle alive
    await arm(ra, rb);
    const b = await S(A, 'dungeon/battle'); const id = b.body.id; const e = b.body.combatants.find((c: any) => c.side === 'enemy').id;
    expect((await call('POST', `/battles/${id}/action`, { turn: 1, command: { type: 'attack', target: e } }, A.t)).body.waiting).toBe(true);
    await wait(900); await sweepDungeons();
    await until(() => ba.battle.some((m: any) => m.id === id && m.turn === 2));
    const st = (await pool.query('SELECT state FROM battle_logs WHERE id=$1', [id])).rows[0].state;
    const pb = st.combatants.find((x: any) => x.characterId === Bu.id).id;
    expect(st.log.some((l: any) => l.turn === 1 && l.actor === pb && l.kind === 'defend')).toBe(true);
    // B disconnects (leaves the instance room): A's command resolves immediately
    await rb.leave(true); await wait(200);
    const r = await call('POST', `/battles/${id}/action`, { turn: 2, command: { type: 'attack', target: e } }, A.t);
    expect(r.body, JSON.stringify({ ...r.body, log: undefined, combatants: undefined })).toMatchObject({ turn: 3 }); expect(r.body.waiting).toBeUndefined();
    rb = await joinDg(Bu, inst); bb = box(rb);
    await pool.query(`UPDATE battle_logs SET state=jsonb_set(state,'{combatants}',(SELECT jsonb_agg(CASE WHEN x->>'side'='player' THEN x || '{"atk":300}' ELSE x END) FROM jsonb_array_elements(state->'combatants') x)) WHERE id=$1`, [id]);
    await fight(id, [A, Bu]);
    expect((await pool.query('SELECT result FROM battle_logs WHERE id=$1', [id])).rows[0].result).toBe('victory');
  });
  it('boss floor: phase transitions, clear, clear reward per member with double-claim guard', async () => {
    await S(A, 'dungeon/chest'); await S(A, 'dungeon/next');
    const d = await D(A); expect(d.floor).toBe(3); expect(d.isBoss).toBe(true);
    expect((await S(A, 'dungeon/claim')).body.error).toBe('not_cleared');
    await stats(A.id, 75); await stats(Bu.id, 75);
    await arm(ra, rb);
    const b = await S(A, 'dungeon/battle'); expect(b.body.canFlee).toBe(false);
    expect(b.body.combatants.find((c: any) => c.side === 'enemy').phases).toBeUndefined(); // phase table not sent to clients
    await fight(b.body.id, [A, Bu]);
    const st = (await pool.query('SELECT state, result FROM battle_logs WHERE id=$1', [b.body.id])).rows[0];
    expect(st.result).toBe('victory');
    expect(st.state.log.filter((l: any) => l.kind === 'phase').map((l: any) => l.value)).toEqual([2, 3]);
    expect((await D(A)).status).toBe('cleared');
    const g0 = await gold(A.id);
    const rs = await Promise.all([1, 2, 3].map(() => S(A, 'dungeon/claim')));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await gold(A.id)).toBe(g0 + 300);
    expect((await S(Bu, 'dungeon/claim')).status).toBe(200);
    expect((await S(Bu, 'dungeon/claim')).body.error).toBe('already_claimed');
    expect((await S(A, 'dungeon/leave')).body.ok).toBe(true); expect(await D(A)).toBeNull();
    expect((await D(Bu)).leader).toBe(Bu.id);
    expect((await S(Bu, 'dungeon/leave')).body.status).toBe('cleared');
    // re-entry condition: a character who just cleared waits reentryCooldownMin before entering again
    await toEntrance(A.id);
    expect((await S(A, 'dungeon/enter', { dungeonId: 'ancient_ruins' })).body.error).toBe('reentry_cooldown');
    await pool.query(`UPDATE dungeon_instances SET ended_at=now()-interval '11 minutes' WHERE id=$1`, [inst]);
    const ok2 = await S(A, 'dungeon/enter', { dungeonId: 'ancient_ruins' }); expect(ok2.status).toBe(201);
    await S(A, 'dungeon/leave'); await S(Bu, 'dungeon/leave');
  });
  it('BUG-023: a member online in the dungeon room but without battle_ready does not stall the turn', async () => {
    // C enters a fresh instance alone first so we can add A+B as a separate party later is messy;
    // reuse the current instance? it may already be cleared. Start a brand-new run with 3 members.
    for (const u of [A, Bu, C]) { await toEntrance(u.id); await stats(u.id, 1, 400); }
    await pool.query(`UPDATE dungeon_members SET left_at=coalesce(left_at, now()) WHERE character_id = ANY($1) AND left_at IS NULL`, [[A.id, Bu.id, C.id]]);
    await pool.query(`UPDATE dungeon_instances SET status='failed', ended_at=coalesce(ended_at,now()) WHERE status='active' AND id IN (SELECT instance_id FROM dungeon_members WHERE character_id = ANY($1))`, [[A.id, Bu.id, C.id]]);
    await wait(50);
    // C is not in the party of A — re-form? The earlier tests already have a party of A+B; C is solo.
    // Use A+B only, with B joining the dungeon room but NOT sending battle_ready (simulates a reload stuck on the dungeon panel).
    const ok = await S(A, 'dungeon/enter', { dungeonId: 'ancient_ruins' }); expect(ok.status).toBe(201);
    const inst2 = ok.body.dungeon.id as string;
    const ra2 = await joinDg(A, inst2, true);
    const rb2 = await joinDg(Bu, inst2, false); // online, not battle-ready
    const b = await S(A, 'dungeon/battle'); const id = b.body.id;
    const e = b.body.combatants.find((c: any) => c.side === 'enemy').id;
    const t0 = Date.now();
    const r = await call('POST', `/battles/${id}/action`, { turn: 1, command: { type: 'attack', target: e } }, A.t);
    expect(r.body.waiting, JSON.stringify({ ...r.body, log: undefined, combatants: undefined })).toBeUndefined();
    expect(r.body.turn).toBe(2);
    expect(Date.now() - t0).toBeLessThan(600); // must not have waited for the 800ms deadline
    const st = (await pool.query('SELECT state FROM battle_logs WHERE id=$1', [id])).rows[0].state;
    const pb = st.combatants.find((x: any) => x.characterId === Bu.id).id;
    expect(st.log.some((l: any) => l.turn === 1 && l.actor === pb && l.kind === 'defend')).toBe(true);
    // once B signals ready, the next turn does wait
    rb2.send('battle_ready'); await wait(50);
    const r2 = await call('POST', `/battles/${id}/action`, { turn: 2, command: { type: 'attack', target: e } }, A.t);
    expect(r2.body.waiting).toBe(true);
    const r3 = await call('POST', `/battles/${id}/action`, { turn: 2, command: { type: 'attack', target: e } }, Bu.t);
    expect(r3.body.turn === 3 || r3.body.status !== 'active' || r2.body.turn === 3).toBe(true);
    await S(A, 'dungeon/leave').catch(() => {}); await S(Bu, 'dungeon/leave').catch(() => {});
    await Promise.all([ra2.leave(true).catch(() => {}), rb2.leave(true).catch(() => {})]);
  });
  it('defeat: whole party returns to town at 30% HP and the instance fails', async () => {
    if (!(await D(C))) { await toEntrance(C.id); const ent = await S(C, 'dungeon/enter', { dungeonId: 'ancient_ruins' }); expect(ent.status).toBe(201); }
    await pool.query('UPDATE character_stats SET hp=1, max_hp=100, def=0, atk=1 WHERE character_id=$1', [C.id]);
    const b = await S(C, 'dungeon/battle');
    let cur = b.body; for (let i = 0; i < 20 && cur.status === 'active'; i++) cur = (await call('POST', `/battles/${b.body.id}/action`, { turn: cur.turn, command: { type: 'defend' } }, C.t)).body;
    expect(cur.status).toBe('defeat');
    const ch = (await pool.query('SELECT c.map_id, s.hp FROM characters c JOIN character_stats s ON s.character_id=c.id WHERE c.id=$1', [C.id])).rows[0];
    expect(ch).toEqual({ map_id: 'asteria', hp: 30 });
    expect(await D(C)).toBeNull();
    expect((await pool.query(`SELECT status FROM dungeon_instances WHERE id=$1`, [b.body.dungeonInstanceId])).rows[0].status).toBe('failed');
  });
  it('expiry: an instance past its time limit is closed and members released', async () => {
    await toEntrance(C.id); await pool.query('UPDATE character_stats SET hp=100 WHERE character_id=$1', [C.id]);
    const r = await S(C, 'dungeon/enter', { dungeonId: 'ancient_ruins' }); expect(r.status).toBe(201);
    await pool.query(`UPDATE dungeon_instances SET expires_at=now()-interval '1 second' WHERE id=$1`, [r.body.dungeon.id]);
    await sweepDungeons();
    expect((await pool.query(`SELECT status FROM dungeon_instances WHERE id=$1`, [r.body.dungeon.id])).rows[0].status).toBe('expired');
    expect(await D(C)).toBeNull();
  });
});
