import { describe, it, expect, beforeAll, afterAll } from 'vitest';
process.env.EMAIL_CONFIRM = '1';
process.env.MAIL_DIR = '/tmp/astral-mail-test';
import { mkdirSync, rmSync } from 'node:fs';
try { rmSync('/tmp/astral-mail-test', { recursive: true }); } catch {}
mkdirSync('/tmp/astral-mail-test', { recursive: true });
const { createGameServer } = await import('../src/app.js');
const { lastMail } = await import('../src/services/mail.js');
const { resetDb } = await import('./setup-db.js');
const { pool } = await import('../src/db/pool.js');
const PORT = 25691, B = `http://127.0.0.1:${PORT}/api`;
const { gameServer } = createGameServer({ authLimit: 1000, createLimit: 1000 } as any);
const call = async (method: string, path: string, body?: unknown, token = '') => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
beforeAll(async () => { await resetDb(); await gameServer.listen(PORT); });
afterAll(async () => { await gameServer.gracefullyShutdown(false); await pool.end(); });

describe('email confirmation + password reset (dev mail transport)', () => {
  const email = 'verify@example.com', password = 'password123', nextPw = 'password456';
  it('register sends a confirm mail and login is blocked until confirmed', async () => {
    const reg = await call('POST', '/auth/register', { email, password });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201); expect(reg.body.devConfirmToken, JSON.stringify(reg.body)).toBeTruthy();
    const mail = lastMail(email, 'confirm'); expect(mail?.text).toContain(reg.body.devConfirmToken);
    const denied = await call('POST', '/auth/login', { email, password });
    expect(denied.status).toBe(403); expect(denied.body.error).toBe('email_unverified');
    expect((await call('POST', '/auth/confirm', { token: 'nope' })).status).toBe(400);
    expect((await call('POST', '/auth/confirm', { token: reg.body.devConfirmToken })).body.ok).toBe(true);
    const ok = await call('POST', '/auth/login', { email, password });
    expect(ok.status).toBe(200); expect(ok.body.token).toBeTruthy();
    // reuse of the confirm token fails
    expect((await call('POST', '/auth/confirm', { token: reg.body.devConfirmToken })).status).toBe(400);
  });
  it('forgot-password never reveals whether the email exists; a real token resets and revokes sessions', async () => {
    const ghost = await call('POST', '/auth/forgot', { email: 'nobody@example.com' });
    expect(ghost.status).toBe(200); expect(lastMail('nobody@example.com')).toBeUndefined();
    const login = await call('POST', '/auth/login', { email, password }); expect(login.status).toBe(200);
    await call('POST', '/auth/forgot', { email });
    const mail = lastMail(email, 'reset'); expect(mail?.text).toMatch(/[0-9a-f]{32}/);
    const token = mail!.text.match(/([0-9a-f]{48})/)?.[1] ?? mail!.text.match(/([0-9a-f]{32,})/)?.[1];
    expect(token).toBeTruthy();
    expect((await call('POST', '/auth/reset', { token, password: 'short' })).status).toBe(400);
    expect((await call('POST', '/auth/reset', { token, password: nextPw })).body.ok).toBe(true);
    // old session is dead, old password is dead, new password works
    expect((await call('GET', '/me', undefined, login.body.token)).status).toBe(401);
    expect((await call('POST', '/auth/login', { email, password })).status).toBe(401);
    expect((await call('POST', '/auth/login', { email, password: nextPw })).status).toBe(200);
    expect((await call('GET', '/dev/mailbox?to=' + email)).body.length).toBeGreaterThanOrEqual(2);
  });
});
