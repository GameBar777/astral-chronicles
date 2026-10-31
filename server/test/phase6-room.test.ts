import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client, type Room } from 'colyseus.js';
import { createGameServer } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { resetDb } from './setup-db.js';
const PORT = 25676, B = `http://127.0.0.1:${PORT}/api`, WS = `ws://127.0.0.1:${PORT}`;
const { gameServer } = createGameServer({ authLimit: 1000, createLimit: 1000 } as any);
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
const until = async (f: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timeout'); await wait(20); } };
const players = (r: Room) => [...((r.state as any)?.players?.values() ?? [])] as any[];
const age = (id: string) => pool.query(`UPDATE characters SET pos_updated_at=now()-interval '1 hour' WHERE id=$1`, [id]);
let A: any, Bu: any; const rooms: Room[] = [];
const join = async (u: any, mapId = 'asteria') => { const r = await new Client(WS).joinOrCreate('world', { token: u.t, characterId: u.id, mapId }); rooms.push(r); return r; };
beforeAll(async () => { await resetDb(); await gameServer.listen(PORT); A = await user('a6@example.com', 'ルームA'); Bu = await user('b6@example.com', 'ルームB'); });
afterAll(async () => { for (const r of rooms) await Promise.race([r.leave().catch(() => {}), wait(300)]); await Promise.race([gameServer.gracefullyShutdown(false), wait(2000)]); await pool.end(); });
describe('PHASE 6 WorldRoom', () => {
  it('rejects missing/invalid token, other user\'s character, and wrong map', async () => {
    await expect(new Client(WS).joinOrCreate('world', { mapId: 'asteria', characterId: A.id })).rejects.toThrow(/unauthorized/);
    await expect(new Client(WS).joinOrCreate('world', { token: 'bogus', mapId: 'asteria', characterId: A.id })).rejects.toThrow(/unauthorized/);
    await expect(new Client(WS).joinOrCreate('world', { token: Bu.t, mapId: 'asteria', characterId: A.id })).rejects.toThrow(/character_not_found/);
    await expect(new Client(WS).joinOrCreate('world', { token: A.t, mapId: 'green_meadow', characterId: A.id })).rejects.toThrow(/wrong_map/);
  });
  it('two players in the same map room see each other with names; valid move is synced and stored', async () => {
    const ra = await join(A), rb = await join(Bu);
    expect(ra.roomId).toBe(rb.roomId);
    await until(() => players(ra).length === 2 && players(rb).length === 2);
    expect(players(rb).map((p) => p.name).sort()).toEqual(['ルームA', 'ルームB']);
    const me = { ...players(rb).find((p) => p.id === A.id) } as any; me.x = players(rb).find((p) => p.id === A.id).x; me.y = players(rb).find((p) => p.id === A.id).y;
    await age(A.id); ra.send('move', { x: me.x + 30, y: me.y, facing: 'right', moving: true });
    await until(() => players(rb).find((p) => p.id === A.id).x === me.x + 30);
    expect(players(rb).find((p) => p.id === A.id).facing).toBe('right');
    expect((await pool.query('SELECT pos_x FROM characters WHERE id=$1', [A.id])).rows[0].pos_x).toBe(me.x + 30);
  });
  it('teleport / wall moves are rejected: correction sent, others never see the bad position', async () => {
    const ra = rooms[0], rb = rooms[1]; const before = players(rb).find((p) => p.id === A.id).x;
    const corr: any[] = []; ra.onMessage('correct', (m) => corr.push(m));
    ra.send('move', { x: before + 900, y: 300, facing: 'right', moving: true });
    await until(() => corr.length === 1);
    expect(corr[0].reason).toMatch(/too_fast|blocked/); expect(corr[0].pos.x).toBe(before);
    ra.send('move', { x: 0, y: 0 }); await until(() => corr.length === 2); expect(corr[1].reason).toBe('blocked');
    await wait(150); expect(players(rb).find((p) => p.id === A.id).x).toBe(before);
  });
  it('different maps are different rooms', async () => {
    const C = await user('c6@example.com', 'ルームC');
    await pool.query(`UPDATE characters SET map_id='green_meadow', pos_x=112, pos_y=563 WHERE id=$1`, [C.id]);
    const rc = await join(C, 'green_meadow');
    expect(rc.roomId).not.toBe(rooms[0].roomId); await until(() => players(rc).length === 1);
    expect(players(rooms[0]).some((p) => p.id === C.id)).toBe(false);
    await rc.leave(); rooms.pop();
  });
  it('unexpected disconnect keeps the player during the grace period and reconnect restores the session', async () => {
    const ra = rooms[0], rb = rooms[1]; const token = ra.reconnectionToken;
    (ra as any).connection.close(4999, 'network drop'); // not consented
    await wait(300); expect(players(rb).some((p) => p.id === A.id)).toBe(true);
    const back = await new Client(WS).reconnect(token); rooms[0] = back;
    await until(() => players(back).length === 2);
    expect(back.sessionId).toBe(ra.sessionId);
  });
  it('consented leave removes the player for everyone; duplicate login kicks the older connection', async () => {
    const rb = rooms[1];
    await rooms[0].leave(true); await until(() => players(rb).length === 1);
    const r1 = await join(A); let kicked = 0; r1.onLeave((code) => { kicked = code; });
    await join(A); await until(() => kicked === 4001);
    await until(() => players(rb).filter((p) => p.id === A.id).length === 1);
  });
  it('rejoining (page reload) while the old seat is in reconnection grace leaves no ghost', async () => {
    const rb = rooms[1]; const old = rooms[rooms.length - 1]; const token = old.reconnectionToken;
    (old as any).connection.close(4999, 'reload'); await wait(200);
    await join(A); await wait(300);
    expect(players(rb).filter((p) => p.id === A.id).length).toBe(1);
    await expect(new Client(WS).reconnect(token)).rejects.toThrow();
  });
});
