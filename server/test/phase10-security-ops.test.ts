import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client, type Room } from 'colyseus.js';
import { createGameServer } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { resetDb } from './setup-db.js';
import { __resetSpam } from '../src/services/social.js';
import { __resetMaintCache } from '../src/services/ops.js';
const PORT = 25680, B = `http://127.0.0.1:${PORT}/api`, WS = `ws://127.0.0.1:${PORT}`;
const { gameServer } = createGameServer({ authLimit: 1000, createLimit: 1000, actionLimit: 10000 } as any);
const raw = (method: string, path: string, body?: string, token = '', ct = 'application/json') => fetch(B + path, { method, headers: { 'content-type': ct, authorization: `Bearer ${token}` }, body });
const call = async (method: string, path: string, body?: unknown, token = '') => { const r = await raw(method, path, body === undefined ? undefined : JSON.stringify(body), token); return { status: r.status, body: await r.json().catch(() => null), headers: r.headers }; };
const user = async (email: string, name: string) => {
  await call('POST', '/auth/register', { email, password: 'password123' });
  const t = (await call('POST', '/auth/login', { email, password: 'password123' })).body.token;
  const c = await call('POST', '/characters', { name, class: 'priest', appearance: { bodyType: 'a', hairStyle: 1, hairColor: 2, skinColor: 0 } }, t);
  return { t, id: c.body.id as string, email, name };
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timeout'); await wait(20); } };
const rooms: Room[] = [];
const join = async (u: any) => { const r = await new Client(WS).joinOrCreate('world', { token: u.t, characterId: u.id, mapId: 'asteria' }); rooms.push(r); const box: any[] = []; r.onMessage('chat', (m) => box.push(m)); r.onMessage('chat_error', (m) => box.push({ error: m.code })); r.onMessage('*', () => {}); return { r, box }; };
let ADM: any, GM: any, P1: any, P2: any, P3: any;
beforeAll(async () => {
  await resetDb(); await gameServer.listen(PORT);
  ADM = await user('adm@example.com', '運営係'); GM = await user('gm@example.com', '進行役'); P1 = await user('p1@example.com', '旅人一'); P2 = await user('p2@example.com', '旅人二'); P3 = await user('p3@example.com', '旅人三');
  await pool.query(`UPDATE users SET role='admin' WHERE email='adm@example.com'`); await pool.query(`UPDATE users SET role='gm' WHERE email='gm@example.com'`);
});
afterAll(async () => { for (const r of rooms) await Promise.race([r.leave().catch(() => {}), wait(300)]); await pool.query(`UPDATE server_settings SET value='{"on":false,"message":""}' WHERE key='maintenance'`); await Promise.race([gameServer.gracefullyShutdown(false), wait(2000)]); await pool.end(); });

describe('PHASE 10 security', () => {
  it('security headers on API and health', async () => {
    const r = await raw('GET', '/status');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff'); expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('content-security-policy')).toContain("script-src 'self'"); expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-powered-by')).toBeNull();
  });
  it('every character/admin endpoint requires a valid session; foreign characters are invisible', async () => {
    for (const [m, p] of [['GET', `/characters/${P1.id}/items`], ['POST', `/characters/${P1.id}/market/list`], ['GET', '/admin/status'], ['POST', '/admin/grant'], ['GET', `/characters/${P1.id}/social`]])
      expect((await call(m, p, m === 'POST' ? {} : undefined, 'bogus-token')).status).toBe(401);
    expect((await call('GET', `/characters/${P1.id}/items`, undefined, P2.t)).body.error).toBe('character_not_found');
  });
  it('SQL injection payloads are treated as data', async () => {
    const inj = "' OR 1=1; DROP TABLE users; --";
    expect((await call('POST', '/auth/login', { email: inj, password: inj })).status).toBe(401);
    expect((await call('GET', `/market?search=${encodeURIComponent(inj)}`, undefined, P1.t)).body.listings).toEqual([]);
    expect((await call('GET', `/characters/${encodeURIComponent("x' OR '1'='1")}/items`, undefined, P1.t)).body.error).toBe('character_not_found');
    expect((await call('POST', `/characters/${P1.id}/friends/request`, { name: inj }, P1.t)).body.error).toBe('target_not_found');
    expect((await pool.query('SELECT count(*)::int n FROM users')).rows[0].n).toBe(5);
  });
  it('malformed / oversized / wrong-typed bodies are rejected without leaking internals', async () => {
    expect((await (await raw('POST', '/auth/login', '{"email":', '')).json()).error).toBe('invalid_json');
    expect((await raw('POST', '/auth/login', JSON.stringify({ email: 'a'.repeat(20000), password: 'x' }))).status).toBe(413);
    const r = await call('POST', '/auth/login', { email: ['x'], password: { $gt: '' } }); expect(r.status).toBe(400); expect(JSON.stringify(r.body)).not.toMatch(/stack|pg|SELECT/i);
  });
  it('players cannot use admin tools (role is read from the DB)', async () => {
    for (const p of ['/admin/maintenance', '/admin/ban', '/admin/grant', '/admin/announcements', '/admin/mute']) expect((await call('POST', p, { role: 'admin' }, P1.t)).body.error).toBe('forbidden');
    expect((await call('GET', '/admin/status', undefined, P1.t)).status).toBe(403);
    expect((await call('POST', '/admin/grant', { name: P1.name, itemId: 'herb', qty: 1, grantId: 'x1234' }, GM.t)).body.error).toBe('forbidden'); // gm < admin
  });
  it('login success / failure is written to the audit log', async () => {
    await call('POST', '/auth/login', { email: P3.email, password: 'wrong-pass' });
    const logs = (await call('GET', '/admin/logs?action=auth.', undefined, GM.t)).body;
    expect(logs.some((l: any) => l.action === 'auth.login_failed')).toBe(true); expect(logs.some((l: any) => l.action === 'auth.login')).toBe(true);
  });
});

describe('PHASE 10 operations', () => {
  it('status + announcements: gm posts, everyone reads, action audited', async () => {
    const s = (await call('GET', '/admin/status', undefined, GM.t)).body; expect(s.characters).toBe((await pool.query('SELECT count(*)::int n FROM characters')).rows[0].n); expect(typeof s.rssMB).toBe('number');
    expect((await call('POST', '/admin/announcements', { title: '', body: 'x' }, GM.t)).body.error).toBe('invalid_announcement');
    expect((await call('POST', '/admin/announcements', { title: '定期メンテナンスのお知らせ', body: '毎週木曜 15:00〜17:00', hours: 24 }, GM.t)).status).toBe(201);
    expect((await call('GET', '/announcements')).body[0].title).toBe('定期メンテナンスのお知らせ');
    expect((await call('GET', '/admin/logs?action=admin.announce', undefined, GM.t)).body).toHaveLength(1);
  });
  it('item distribution is idempotent per grantId', async () => {
    const g = { name: P1.name, itemId: 'potion_small', qty: 3, grantId: 'event-2026-11' };
    expect((await call('POST', '/admin/grant', g, ADM.t)).body.granted).toBe(true);
    expect((await call('POST', '/admin/grant', g, ADM.t)).body.granted).toBe(false);
    const n = (await pool.query(`SELECT count(*)::int n FROM transactions WHERE character_id=$1 AND idempotency_key='grant:event-2026-11'`, [P1.id])).rows[0].n; expect(n).toBe(1);
  });
  it('maintenance mode: players blocked from API, login and rooms; staff keep access', async () => {
    expect((await call('POST', '/admin/maintenance', { on: true, message: '緊急メンテナンス中' }, GM.t)).body.error).toBe('forbidden');
    expect((await call('POST', '/admin/maintenance', { on: true, message: '緊急メンテナンス中' }, ADM.t)).body.on).toBe(true); __resetMaintCache();
    expect((await call('GET', '/status')).body).toMatchObject({ maintenance: true, message: '緊急メンテナンス中' });
    expect((await call('GET', `/characters/${P1.id}/items`, undefined, P1.t)).body.error).toBe('maintenance');
    expect((await call('POST', '/auth/login', { email: P2.email, password: 'password123' })).body.error).toBe('maintenance');
    await expect(join(P1)).rejects.toBeTruthy();
    expect((await call('GET', `/characters/${GM.id}/items`, undefined, GM.t)).status).toBe(200);
    await call('POST', '/admin/maintenance', { on: false }, ADM.t); __resetMaintCache();
    expect((await call('GET', `/characters/${P1.id}/items`, undefined, P1.t)).status).toBe(200);
  });
  it('ban revokes sessions and blocks login; staff cannot be banned', async () => {
    const t3 = P3.t;
    expect((await call('POST', '/admin/ban', { name: GM.name, ban: true }, ADM.t)).body.error).toBe('forbidden');
    expect((await call('POST', '/admin/ban', { name: P3.name, ban: true }, ADM.t)).body.ok).toBe(true);
    expect((await call('GET', `/characters/${P3.id}/items`, undefined, t3)).status).toBe(401);
    expect((await call('POST', '/auth/login', { email: P3.email, password: 'password123' })).body.error).toBe('banned');
    await call('POST', '/admin/ban', { name: P3.name, ban: false }, ADM.t);
    P3.t = (await call('POST', '/auth/login', { email: P3.email, password: 'password123' })).body.token; expect(P3.t).toBeTruthy();
  });
});

describe('PHASE 10 chat gaps: whisper, block, persistent mute', () => {
  let a: any, b: any, c: any;
  it('whisper reaches only the recipient (and echoes to the sender); offline / unknown targets rejected', async () => {
    a = await join(P1); b = await join(P2); c = await join(P3);
    a.r.send('chat', { channel: 'whisper', to: P2.name, body: 'ないしょ話' });
    await until(() => b.box.some((m: any) => m.body === 'ないしょ話')); await until(() => a.box.some((m: any) => m.body === 'ないしょ話'));
    await wait(200); expect(c.box.some((m: any) => m.body === 'ないしょ話')).toBe(false);
    expect(b.box.find((m: any) => m.body === 'ないしょ話')).toMatchObject({ channel: 'whisper', from: { id: P1.id }, to: { id: P2.id } });
    a.r.send('chat', { channel: 'whisper', to: '存在しない人', body: 'x' }); await until(() => a.box.some((m: any) => m.error === 'target_not_found'));
    a.r.send('chat', { channel: 'whisper', to: GM.name, body: 'y' }); await until(() => a.box.some((m: any) => m.error === 'target_offline'));
  });
  it('block: blocked player\'s local chat and whispers never arrive; friend requests refused; unblock restores', async () => {
    expect((await call('POST', `/characters/${P2.id}/block`, { name: P1.name }, P2.t)).body.ok).toBe(true);
    expect((await call('GET', `/characters/${P2.id}/social`, undefined, P2.t)).body.blocks.map((x: any) => x.id)).toEqual([P1.id]);
    __resetSpam(); a.r.send('chat', { channel: 'local', body: 'みんなこんにちは' });
    await until(() => c.box.some((m: any) => m.body === 'みんなこんにちは')); await wait(250);
    expect(b.box.some((m: any) => m.body === 'みんなこんにちは')).toBe(false);
    a.r.send('chat', { channel: 'whisper', to: P2.name, body: 'ねえ' }); await until(() => a.box.some((m: any) => m.error === 'blocked'));
    expect((await call('POST', `/characters/${P1.id}/friends/request`, { name: P2.name }, P1.t)).body.error).toBe('blocked');
    expect((await call('POST', `/characters/${P2.id}/unblock`, { characterId: P1.id }, P2.t)).body.ok).toBe(true);
    __resetSpam(); a.r.send('chat', { channel: 'local', body: 'もう一度' }); await until(() => b.box.some((m: any) => m.body === 'もう一度'));
  });
  it('spam auto-mute is persisted and survives a process restart (in-memory state cleared)', async () => {
    __resetSpam();
    for (let i = 0; i < 9; i++) a.r.send('chat', { channel: 'local', body: '連投' });
    await until(() => a.box.some((m: any) => m.error === 'muted'));
    expect((await pool.query('SELECT until > now() m FROM chat_mutes WHERE character_id=$1', [P1.id])).rows[0].m).toBe(true);
    __resetSpam(); const n = a.box.length; a.r.send('chat', { channel: 'local', body: '再起動後' });
    await until(() => a.box.length > n); expect(a.box.at(-1).error).toBe('muted');
    expect((await call('GET', `/characters/${P1.id}/social`, undefined, P1.t)).body.mutedUntil).toBeTruthy();
  });
  it('gm mute / unmute', async () => {
    expect((await call('POST', '/admin/mute', { name: P3.name, minutes: 10 }, GM.t)).body.ok).toBe(true);
    __resetSpam(); c.r.send('chat', { channel: 'local', body: '発言' }); await until(() => c.box.some((m: any) => m.error === 'muted'));
    await call('POST', '/admin/mute', { name: P3.name, minutes: 0 }, GM.t); __resetSpam();
    c.r.send('chat', { channel: 'local', body: '解除後の発言' }); await until(() => c.box.some((m: any) => m.body === '解除後の発言'));
  });
});
describe('GET /me role', () => {
  it('returns player by default and admin after a DB promotion', async () => {
    const email = `me_${Date.now()}@example.com`;
    await call('POST', '/auth/register', { email, password: 'correct-horse-9' });
    const { token } = (await call('POST', '/auth/login', { email, password: 'correct-horse-9' })).body;
    const a = await call('GET', '/me', undefined, token);
    expect(a.status).toBe(200); expect(a.body.role).toBe('player'); expect(a.body.email).toBe(email);
    const uid = a.body.userId;
    const { pool } = await import('../src/db/pool.js');
    await pool.query(`UPDATE users SET role='admin' WHERE id=$1`, [uid]);
    // role is read from DB on each request (new session still has player until re-resolve)
    // resolveSession reads users.role every time, so the same token should now be admin
    const b = await call('GET', '/me', undefined, token);
    expect(b.body.role).toBe('admin');
  });
});
