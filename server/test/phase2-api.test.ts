import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createGameServer } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { grantExp } from '../src/services/characters.js';
import { resetDb } from './setup-db.js';
import { expToNext, statsAt } from '@astral/shared';
const PORT = 25671, B = `http://127.0.0.1:${PORT}/api`;
const { gameServer } = createGameServer({ authLimit: 1000, createLimit: 1000 });
beforeAll(async () => { await resetDb(); await gameServer.listen(PORT); });
afterAll(async () => { await gameServer.gracefullyShutdown(false); await pool.end().catch(() => {}); });
const call = async (method: string, path: string, body?: unknown, token?: string) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const APP = { bodyType: 'a', hairStyle: 1, hairColor: 2, skinColor: 0 };
let token = '';
describe('auth', () => {
  it('register: ok, duplicate (case-insensitive), invalid input', async () => {
    expect((await call('POST', '/auth/register', { email: 'Alice@Example.test', password: 'password123' })).status).toBe(201);
    expect((await call('POST', '/auth/register', { email: 'alice@example.test', password: 'password123' })).body).toEqual({ error: 'email_taken' });
    expect((await call('POST', '/auth/register', { email: 'bad', password: 'password123' })).status).toBe(400);
    expect((await call('POST', '/auth/register', { email: 'b@example.test', password: 'short' })).status).toBe(400);
    expect((await call('POST', '/auth/register', { email: "x';DROP_TABLE_users;--@a.bc", password: 'password123' })).status).toBe(201); // stored as data, not executed
    expect((await call('POST', '/auth/register', '{bad json')).body).toEqual({ error: 'invalid_json' });
  });
  it('password stored as bcrypt hash only', async () => {
    const h = (await pool.query(`SELECT password_hash FROM users WHERE email='alice@example.test'`)).rows[0].password_hash;
    expect(h).toMatch(/^\$2[aby]\$/); expect(h).not.toContain('password123');
  });
  it('login: wrong password / unknown user give same 401; success returns token; session stored hashed', async () => {
    expect((await call('POST', '/auth/login', { email: 'alice@example.test', password: 'nope-nope' })).body).toEqual({ error: 'invalid_credentials' });
    expect((await call('POST', '/auth/login', { email: 'ghost@example.test', password: 'password123' })).body).toEqual({ error: 'invalid_credentials' });
    const r = await call('POST', '/auth/login', { email: 'ALICE@example.test', password: 'password123' });
    expect(r.status).toBe(200); token = r.body.token; expect(token.length).toBeGreaterThan(30);
    expect((await pool.query('SELECT count(*)::int n FROM sessions WHERE token_hash=$1', [token])).rows[0].n).toBe(0);
    expect((await call('GET', '/me', undefined, token)).status).toBe(200);
  });
  it('unauthenticated / bogus token rejected', async () => {
    expect((await call('GET', '/characters')).status).toBe(401);
    expect((await call('GET', '/characters', undefined, 'forged')).status).toBe(401);
  });
  it('banned user cannot login', async () => {
    await call('POST', '/auth/register', { email: 'bad@example.test', password: 'password123' });
    await pool.query(`UPDATE users SET is_banned=true WHERE email='bad@example.test'`);
    expect((await call('POST', '/auth/login', { email: 'bad@example.test', password: 'password123' })).status).toBe(403);
  });
});
describe('characters', () => {
  let charId = '';
  it('create with correct class stats & starting skill', async () => {
    const r = await call('POST', '/characters', { name: 'アルド', class: 'warrior', appearance: APP }, token);
    expect(r.status).toBe(201); charId = r.body.id;
    const s = statsAt('warrior', 1);
    expect(r.body).toMatchObject({ name: 'アルド', class: 'warrior', level: 1, exp: 0, gold: 0, max_hp: s.maxHp, hp: s.maxHp, atk: s.atk, map_id: 'asteria' });
    expect((await pool.query('SELECT skill_id FROM character_skills WHERE character_id=$1', [charId])).rows).toEqual([{ skill_id: 'warrior_power_strike' }]);
  });
  it('server-side name validation', async () => {
    for (const [name, err] of [['あ', 'name_too_short'], ['あいうえおかきくけこさしす', 'name_too_long'], ['<b>x</b>', 'name_invalid_chars'], ['運営です', 'name_banned'], ['9999', 'name_digits_only']]) {
      expect((await call('POST', '/characters', { name, class: 'mage', appearance: APP }, token)).body).toEqual({ error: err });
    }
  });
  it('duplicate names rejected (case/width-insensitive) across users', async () => {
    await call('POST', '/characters', { name: 'Hero', class: 'mage', appearance: APP }, token);
    await call('POST', '/auth/register', { email: 'bob@example.test', password: 'password123' });
    const t2 = (await call('POST', '/auth/login', { email: 'bob@example.test', password: 'password123' })).body.token;
    expect((await call('POST', '/characters', { name: 'ＨＥＲＯ', class: 'knight', appearance: APP }, t2)).body).toEqual({ error: 'name_taken' });
    expect((await call('POST', '/characters', { name: 'hero', class: 'knight', appearance: APP }, t2)).body).toEqual({ error: 'name_taken' });
  });
  it('invalid class / appearance / injected fields rejected', async () => {
    expect((await call('POST', '/characters', { name: 'Mago', class: 'archmage', appearance: APP }, token)).body).toEqual({ error: 'invalid_class' });
    expect((await call('POST', '/characters', { name: 'Mago', class: 'mage', appearance: { ...APP, hairColor: 99 } }, token)).body).toEqual({ error: 'invalid_appearance' });
    const r = await call('POST', '/characters', { name: 'Mago', class: 'mage', appearance: APP, level: 99, gold: 1e9 }, token);
    expect(r.status).toBe(201); expect(r.body.level).toBe(1); expect(r.body.gold).toBe(0); // client-sent stats ignored
  });
  it('per-user limit 3, enforced under concurrent double-submit', async () => {
    expect((await call('POST', '/characters', { name: 'Fourth', class: 'priest', appearance: APP }, token)).body).toEqual({ error: 'character_limit' });
    await call('POST', '/auth/register', { email: 'e@example.test', password: 'password123' });
    const te = (await call('POST', '/auth/login', { email: 'e@example.test', password: 'password123' })).body.token;
    for (const n of ['Eone', 'Etwo']) expect((await call('POST', '/characters', { name: n, class: 'priest', appearance: APP }, te)).status).toBe(201);
    const rs = await Promise.all(['Ceres', 'Dione'].map((n) => call('POST', '/characters', { name: n, class: 'priest', appearance: APP }, te)));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await call('GET', '/characters', undefined, te)).body).toHaveLength(3);
  });
  it('concurrent same-name creation: exactly one wins', async () => {
    await call('POST', '/auth/register', { email: 'c@example.test', password: 'password123' });
    await call('POST', '/auth/register', { email: 'd@example.test', password: 'password123' });
    const tc = (await call('POST', '/auth/login', { email: 'c@example.test', password: 'password123' })).body.token;
    const td = (await call('POST', '/auth/login', { email: 'd@example.test', password: 'password123' })).body.token;
    const rs = await Promise.all([tc, td].map((t) => call('POST', '/characters', { name: 'Twin', class: 'priest', appearance: APP }, t)));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
  });
  it('EXP grant: level up, stat recalculation, idempotent (double reward prevented)', async () => {
    const need = expToNext(1)! + expToNext(2)! + 10;
    const g = await grantExp(charId, need, 'test-battle-1');
    expect(g).toMatchObject({ applied: true, level: 3, exp: 10, levelsGained: 2 });
    expect((g as any).statDiff.maxHp).toBeGreaterThan(0);
    expect(await grantExp(charId, need, 'test-battle-1')).toEqual({ applied: false });
    const [c] = (await call('GET', '/characters', undefined, token)).body.filter((x: any) => x.id === charId);
    const s3 = statsAt('warrior', 3); expect(c).toMatchObject({ level: 3, exp: 10, max_hp: s3.maxHp, hp: s3.maxHp, str: s3.str });
    await expect(grantExp(charId, -1, 'neg')).rejects.toThrow(); // invalid gain rolls back
    expect((await pool.query(`SELECT count(*)::int n FROM transactions WHERE idempotency_key='neg'`)).rows[0].n).toBe(0);
  });
  it('concurrent duplicate EXP grants apply once', async () => {
    const rs = await Promise.all([1, 2, 3].map(() => grantExp(charId, 5, 'dup-key')));
    expect(rs.filter((r) => r.applied)).toHaveLength(1);
  });
});
describe('logout / re-login / rate limit', () => {
  it('logout revokes token; re-login works and data persists', async () => {
    expect((await call('POST', '/auth/logout', undefined, token)).status).toBe(204);
    expect((await call('GET', '/characters', undefined, token)).status).toBe(401);
    const t = (await call('POST', '/auth/login', { email: 'alice@example.test', password: 'password123' })).body.token;
    const cs = (await call('GET', '/characters', undefined, t)).body;
    expect(cs.map((c: any) => c.name).sort()).toEqual(['Hero', 'Mago', 'アルド']);
  });
  it('auth endpoint rate-limited', async () => {
    const { gameServer: g2 } = createGameServer({ authLimit: 3 }); await g2.listen(25672);
    const st = []; for (let i = 0; i < 5; i++) st.push((await fetch('http://127.0.0.1:25672/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"a@b.cd","password":"x"}' })).status);
    await g2.gracefullyShutdown(false);
    expect(st).toEqual([401, 401, 401, 429, 429]);
  });
});
