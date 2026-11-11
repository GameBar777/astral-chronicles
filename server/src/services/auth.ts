import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export class HttpError extends Error { constructor(public status: number, public code: string) { super(code); } }

export function validateCredentials(email: unknown, password: unknown) {
  if (typeof email !== 'string' || !EMAIL.test(email) || email.length > 254) throw new HttpError(400, 'invalid_email');
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) throw new HttpError(400, 'invalid_password');
  return { email: email.trim().toLowerCase(), password };
}
export async function register(emailRaw: unknown, passwordRaw: unknown) {
  const { email, password } = validateCredentials(emailRaw, passwordRaw);
  const hash = await bcrypt.hash(password, config.bcryptRounds);
  try {
    const r = await pool.query('INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id', [email, hash]);
    const extra = await requestConfirm(r.rows[0].id, email);
    return { userId: r.rows[0].id as string, ...extra };
  } catch (e: any) { if (e.code === '23505') throw new HttpError(409, 'email_taken'); throw e; }
}
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 4);
export async function login(emailRaw: unknown, passwordRaw: unknown) {
  if (typeof emailRaw !== 'string' || typeof passwordRaw !== 'string') throw new HttpError(400, 'invalid_request');
  const r = await pool.query('SELECT id,password_hash,is_banned,email_verified_at FROM users WHERE email=$1', [emailRaw.trim().toLowerCase()]);
  const u = r.rows[0];
  const ok = await bcrypt.compare(passwordRaw, u?.password_hash ?? DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, 'invalid_credentials');
  if (u.is_banned) throw new HttpError(403, 'banned');
  if (confirmRequired() && !u.email_verified_at) throw new HttpError(403, 'email_unverified');
  const token = randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)', [u.id, hashToken(token), new Date(Date.now() + SESSION_TTL_MS)]);
  await pool.query('UPDATE users SET last_login_at=now() WHERE id=$1', [u.id]);
  return { token, userId: u.id as string };
}
export async function resolveSession(token: string | undefined) {
  if (!token) return null;
  const r = await pool.query(`SELECT s.id, u.id user_id, u.role FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND NOT u.is_banned`, [hashToken(token)]);
  return r.rows[0] ? { sessionId: r.rows[0].id as string, userId: r.rows[0].user_id as string, role: r.rows[0].role as string } : null;
}
export async function logout(sessionId: string) { await pool.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [sessionId]); }

import { sendMail, hashToken as mailHash, newToken, lastMail } from './mail.js';
const confirmRequired = () => process.env.NODE_ENV === 'production' || process.env.EMAIL_CONFIRM === '1';
const TOKEN_TTL_MS = { confirm: 48 * 3600 * 1000, reset: 2 * 3600 * 1000 };
async function issueToken(userId: string, kind: 'confirm' | 'reset', email: string, subject: string, text: (t: string) => string) {
  const raw = newToken();
  await pool.query(`INSERT INTO email_tokens(user_id,kind,token_hash,expires_at) VALUES($1,$2,$3,now()+$4::interval)`, [userId, kind, mailHash(raw), `${TOKEN_TTL_MS[kind] / 1000} seconds`]);
  const mail = sendMail({ to: email, subject, text: text(raw), kind });
  return { raw, mailId: mail.id };
}
/** called after a successful register: always mails a confirm link; login is blocked only when confirmRequired() */
export async function requestConfirm(userId: string, email: string) {
  const { raw } = await issueToken(userId, 'confirm', email, '【ASTRAL CHRONICLES】メールアドレスの確認', (t) => `以下の確認コードを入力するか、/auth/confirm に token=${t} を送ってください。\n\n${t}\n\nこのコードは48時間で無効になります。`);
  return { emailed: true, ...(config.isProd ? {} : { devConfirmToken: raw }) };
}
export async function confirmEmail(token: unknown) {
  if (typeof token !== 'string' || token.length < 16) throw new HttpError(400, 'invalid_token');
  const r = await pool.query(`SELECT id, user_id FROM email_tokens WHERE token_hash=$1 AND kind='confirm' AND used_at IS NULL AND expires_at>now()`, [mailHash(token)]);
  if (!r.rows[0]) throw new HttpError(400, 'invalid_token');
  await pool.query('UPDATE users SET email_verified_at=coalesce(email_verified_at,now()) WHERE id=$1', [r.rows[0].user_id]);
  await pool.query('UPDATE email_tokens SET used_at=now() WHERE id=$1', [r.rows[0].id]);
  return { ok: true };
}
export async function forgotPassword(emailRaw: unknown) {
  const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : '';
  if (!email) return { ok: true }; // do not reveal whether the account exists
  const u = (await pool.query('SELECT id, email FROM users WHERE email=$1', [email])).rows[0];
  if (u) await issueToken(u.id, 'reset', u.email, '【ASTRAL CHRONICLES】パスワード再設定', (t) => `パスワード再設定コード（2時間有効）:\n\n${t}\n`);
  return { ok: true, ...(u && !confirmRequired() ? { dev: true } : {}) };
}
export async function resetPassword(token: unknown, passwordRaw: unknown) {
  if (typeof token !== 'string' || token.length < 16) throw new HttpError(400, 'invalid_token');
  if (typeof passwordRaw !== 'string' || passwordRaw.length < 8 || Buffer.byteLength(passwordRaw) > 72) throw new HttpError(400, 'invalid_password');
  const r = await pool.query(`SELECT id, user_id FROM email_tokens WHERE token_hash=$1 AND kind='reset' AND used_at IS NULL AND expires_at>now()`, [mailHash(token)]);
  if (!r.rows[0]) throw new HttpError(400, 'invalid_token');
  const hash = await bcrypt.hash(passwordRaw, config.bcryptRounds);
  await pool.query('UPDATE users SET password_hash=$2, email_verified_at=coalesce(email_verified_at,now()) WHERE id=$1', [r.rows[0].user_id, hash]);
  await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [r.rows[0].user_id]);
  await pool.query('UPDATE email_tokens SET used_at=now() WHERE id=$1', [r.rows[0].id]);
  return { ok: true };
}
export { lastMail, confirmRequired };
