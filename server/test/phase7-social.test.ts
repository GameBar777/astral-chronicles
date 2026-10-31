import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client, type Room } from 'colyseus.js';
import { createGameServer } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { resetDb } from './setup-db.js';
const PORT = 25677, B = `http://127.0.0.1:${PORT}/api`, WS = `ws://127.0.0.1:${PORT}`;
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
let A: any, Bu: any, C: any, D: any, E: any; const rooms: Room[] = [];
const join = async (u: any, mapId = 'asteria') => { const r = await new Client(WS).joinOrCreate('world', { token: u.t, characterId: u.id, mapId }); rooms.push(r); return r; };
beforeAll(async () => { await resetDb(); await gameServer.listen(PORT); A = await user('a7@example.com', '社交A'); Bu = await user('b7@example.com', '社交B'); C = await user('c7@example.com', '社交C'); D = await user('d7@example.com', '社交D'); E = await user('e7@example.com', '社交E'); });
afterAll(async () => { for (const r of rooms) await Promise.race([r.leave().catch(() => {}), wait(300)]); await Promise.race([gameServer.gracefullyShutdown(false), wait(2000)]); await pool.end(); });
const S = (u: any, path: string, body: any = {}) => call('POST', `/characters/${u.id}/${path}`, body, u.t);
const view = async (u: any) => (await call('GET', `/characters/${u.id}/social`, undefined, u.t)).body;
const inbox = (r: Room) => { const box: any[] = []; r.onMessage('chat', (m) => box.push(m)); r.onMessage('chat_error', (m) => box.push({ error: m.code })); r.onMessage('chat_history', () => {}); r.onMessage('social', () => {}); r.onMessage('correct', () => {}); return box; };
describe('PHASE 7 social', () => {
  let ra: Room, rb: Room, rc: Room, ma: any[], mb: any[], mc: any[];
  it('local chat reaches everyone in the map room, is stored, and HTML/control chars are not interpreted', async () => {
    ra = await join(A); rb = await join(Bu); rc = await join(C); ma = inbox(ra); mb = inbox(rb); mc = inbox(rc);
    ra.send('chat', { channel: 'local', body: '  こんにちは<b>\u0007 ' });
    await until(() => mb.length === 1 && mc.length === 1);
    expect(mb[0]).toMatchObject({ channel: 'local', body: 'こんにちは<b>', from: { id: A.id, name: '社交A' } });
    const row = (await pool.query(`SELECT channel, scope_id, body FROM chat_messages WHERE sender_character_id=$1`, [A.id])).rows[0];
    expect(row).toEqual({ channel: 'say', scope_id: 'asteria', body: 'こんにちは<b>' });
  });
  it('rejects system channel, empty/oversized body, and flood/duplicate with mute', async () => {
    ra.send('chat', { channel: 'system', body: 'fake' }); ra.send('chat', { channel: 'local', body: '   ' }); ra.send('chat', { channel: 'local', body: 'x'.repeat(201) });
    await until(() => ma.filter((m) => m.error).length === 3);
    expect(ma.filter((m) => m.error).map((m) => m.error)).toEqual(['system_readonly', 'invalid_body', 'invalid_body']);
    ma.length = 0; mb.length = 0;
    for (let i = 0; i < 9; i++) rb.send('chat', { channel: 'local', body: `連投${i}` });
    await until(() => mb.length >= 9);
    const errs = mb.filter((m) => m.error).map((m) => m.error), ok = mb.filter((m) => !m.error && m.from?.id === Bu.id);
    expect(ok.length).toBe(5);
    expect(errs).toContain('muted');
    rb.send('chat', { channel: 'local', body: 'まだミュート' }); await until(() => mb.filter((m) => m.error).length > errs.length);
    expect(mb.at(-1).error).toBe('muted');
  });
  it('party: invite / accept / max 4 / party chat only to members / leader promote / leave', async () => {
    expect((await S(A, 'party/leader', { characterId: Bu.id })).body.error).toBe('not_in_party');
    const inv = await S(A, 'party/invite', { name: '社交B' }); expect(inv.status).toBe(200);
    expect((await view(Bu)).invites).toEqual([{ kind: 'party', id: inv.body.partyId, from: '社交A' }]);
    expect((await S(Bu, 'party/accept', { partyId: inv.body.partyId })).status).toBe(200);
    expect((await S(Bu, 'party/accept', { partyId: inv.body.partyId })).body.error).toBe('invite_not_found'); // replay
    expect((await S(Bu, 'party/invite', { name: '社交C' })).body.error).toBe('not_leader');
    for (const u of [C, D]) { await S(A, 'party/invite', { name: u === C ? '社交C' : '社交D' }); expect((await S(u, 'party/accept', { partyId: inv.body.partyId })).status).toBe(200); }
    expect((await S(A, 'party/invite', { name: '社交E' })).body.error).toBe('party_full');
    const v = await view(A); expect(v.party.members.map((m: any) => m.name)).toEqual(['社交A', '社交B', '社交C', '社交D']); expect(v.party.leader).toBe(A.id);
    mc.length = 0; ma.length = 0;
    const re = await join(E); const me = inbox(re);
    ra.send('chat', { channel: 'party', body: 'パーティー連絡' });
    await until(() => mc.some((m) => m.channel === 'party'));
    await wait(200); expect(me.some((m) => m.channel === 'party')).toBe(false);
    expect((await S(A, 'party/leader', { characterId: C.id })).status).toBe(200);
    expect((await view(D)).party.leader).toBe(C.id);
    expect((await S(A, 'party/kick', { characterId: D.id })).body.error).toBe('not_leader');
    expect((await S(C, 'party/kick', { characterId: D.id })).status).toBe(200);
    await S(C, 'party/leave'); const v2 = await view(A); expect(v2.party.members.length).toBe(2); expect([A.id, Bu.id]).toContain(v2.party.leader);
    expect(ma.some((m) => m.channel === 'system' && /抜けました/.test(m.body))).toBe(true);
  }, 30000);
  it('concurrent accepts cannot exceed 4 members', async () => {
    const pid = (await view(A)).party.id; // A + B
    for (const n of ['社交C', '社交D', '社交E']) await S(A, 'party/invite', { name: n });
    const rs = await Promise.all([C, D, E].map((u) => S(u, 'party/accept', { partyId: pid })));
    expect(rs.filter((r) => r.status === 200).length).toBe(2); expect(rs.filter((r) => r.body.error === 'party_full').length).toBe(1);
    expect((await pool.query('SELECT count(*)::int n FROM party_members WHERE party_id=$1', [pid])).rows[0].n).toBe(4);
  });
  it('friends: request / mutual accept / online flag / remove', async () => {
    expect((await S(A, 'friends/request', { name: '社交A' })).body.error).toBe('self');
    expect((await S(A, 'friends/request', { name: '存在しない' })).body.error).toBe('target_not_found');
    await S(A, 'friends/request', { name: '社交E' });
    expect((await S(A, 'friends/request', { name: '社交E' })).body.error).toBe('already_requested');
    expect((await view(E)).incoming.map((x: any) => x.name)).toEqual(['社交A']);
    expect((await S(E, 'friends/accept', { characterId: A.id })).status).toBe(200);
    const fa = (await view(A)).friends; expect(fa).toHaveLength(1); expect(fa[0]).toMatchObject({ name: '社交E', online: true });
    expect((await S(A, 'friends/remove', { characterId: E.id })).status).toBe(200);
    expect((await view(E)).friends).toHaveLength(0);
  });
  it('guild: create / invite / accept / guild chat only to members', async () => {
    expect((await S(A, 'guild/create', { name: '<x>' })).body.error).toBe('invalid_guild_name');
    const g = await S(A, 'guild/create', { name: '星の旅団' }); expect(g.status).toBe(200);
    expect((await S(Bu, 'guild/create', { name: '星の旅団' })).body.error).toBe('guild_name_taken');
    await S(A, 'guild/invite', { name: '社交C' }); expect((await S(C, 'guild/accept', { guildId: g.body.guildId })).status).toBe(200);
    expect((await S(C, 'guild/invite', { name: '社交D' })).body.error).toBe('not_officer');
    mc.length = 0; mb.length = 0;
    ra.send('chat', { channel: 'guild', body: 'ギルド連絡' });
    await until(() => mc.some((m) => m.channel === 'guild')); await wait(200);
    expect(mb.some((m) => m.channel === 'guild')).toBe(false);
    rb.send('chat', { channel: 'guild', body: 'x' }); await until(() => mb.some((m) => m.error));
    expect(mb.find((m) => m.error).error).toMatch(/not_in_guild|muted/);
  });
  it('battle start/end toggles inBattle in the room state for others', async () => {
    const pa = () => players(rb).find((p) => p.id === A.id);
    await pool.query(`UPDATE characters SET map_id='green_meadow' WHERE id=$1`, [A.id]);
    const b = await call('POST', '/battles', { characterId: A.id, zone: 'green_meadow' }, A.t); expect(b.status).toBe(201);
    await until(() => pa()?.inBattle === true);
    const v = await view(Bu); expect(v.party.members.find((m: any) => m.id === A.id).inBattle).toBe(true);
    let st: any = b.body; for (let i = 0; i < 40 && st.status === 'active'; i++) st = (await call('POST', `/battles/${st.id}/action`, { turn: st.turn, command: { type: 'flee' } }, A.t)).body;
    expect(st.status).not.toBe('active');
    await until(() => pa()?.inBattle === false);
  });
  it('history: rejoin receives recent local/party/system messages', async () => {
    await pool.query(`UPDATE characters SET map_id='asteria' WHERE id=$1`, [A.id]);
    const r = await new Client(WS).joinOrCreate('world', { token: A.t, characterId: A.id, mapId: 'asteria' }); rooms.push(r);
    const h: any[] = await new Promise((res) => r.onMessage('chat_history', res));
    expect(h.some((m) => m.channel === 'local' && m.body === 'こんにちは<b>')).toBe(true);
    expect(h.some((m) => m.channel === 'party' && m.body === 'パーティー連絡')).toBe(true);
    expect(h.some((m) => m.channel === 'system')).toBe(true);
  });
});
