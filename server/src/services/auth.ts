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
    return { userId: r.rows[0].id as string };
  } catch (e: any) { if (e.code === '23505') throw new HttpError(409, 'email_taken'); throw e; }
}
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 4);
export async function login(emailRaw: unknown, passwordRaw: unknown) {
  if (typeof emailRaw !== 'string' || typeof passwordRaw !== 'string') throw new HttpError(400, 'invalid_request');
  const r = await pool.query('SELECT id,password_hash,is_banned FROM users WHERE email=$1', [emailRaw.trim().toLowerCase()]);
  const u = r.rows[0];
  const ok = await bcrypt.compare(passwordRaw, u?.password_hash ?? DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, 'invalid_credentials');
  if (u.is_banned) throw new HttpError(403, 'banned');
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
