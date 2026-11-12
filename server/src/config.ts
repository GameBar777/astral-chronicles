import { config as load } from 'dotenv';
import { fileURLToPath } from 'node:url';
load({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
function req(k: string): string { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; }
const isProd = process.env.NODE_ENV === 'production';
if (isProd && /CHANGE_ME|astral_dev_pw/.test(process.env.DATABASE_URL ?? '')) throw new Error('refusing to start: default DATABASE_URL password in production');

/** Render sets PORT; SERVER_PORT remains the local/dev alias. */
export function resolvePort(env: NodeJS.Dict<string> = process.env): number {
  const n = Number(env.PORT ?? env.SERVER_PORT ?? 2567);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) throw new Error('invalid PORT');
  return n;
}

/** Bind all interfaces by default so a hosted process is reachable. */
export function resolveBindHost(env: NodeJS.Dict<string> = process.env): string {
  return env.BIND_HOST || '0.0.0.0';
}

const TRUTHY = new Set(['1', 'true', 'yes']);
const FALSY = new Set(['0', 'false', 'no']);
export function envFlag(v: string | undefined): boolean | undefined {
  if (v === undefined || v === '') return undefined;
  const s = v.trim().toLowerCase();
  if (TRUTHY.has(s)) return true;
  if (FALSY.has(s)) return false;
  return undefined;
}

/**
 * TLS for Postgres. Render requires SSL.
 * Local hosts (localhost / 127.0.0.1 / ::1) stay unencrypted unless DATABASE_SSL=true.
 * DATABASE_SSL=false forces SSL off (local production-like verification).
 * rejectUnauthorized defaults to false for hosted URLs (Render's common recipe);
 * set DATABASE_SSL_REJECT_UNAUTHORIZED=true or sslmode=verify-full to tighten.
 */
export function pgSslOption(databaseUrl: string, env: NodeJS.Dict<string> = process.env): boolean | { rejectUnauthorized: boolean } | undefined {
  const flag = envFlag(env.DATABASE_SSL);
  if (flag === false) return undefined;
  let host = '';
  let sslmode = '';
  try {
    const u = new URL(databaseUrl.replace(/^postgres(ql)?:/i, 'http:'));
    host = u.hostname;
    sslmode = (u.searchParams.get('sslmode') ?? '').toLowerCase();
  } catch { /* use defaults */ }
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (sslmode === 'disable') return undefined;
  const hosted = flag === true || sslmode === 'require' || sslmode === 'prefer' || sslmode === 'verify-ca' || sslmode === 'verify-full' || (env.NODE_ENV === 'production' && !local);
  if (!hosted) return undefined;
  const verify = envFlag(env.DATABASE_SSL_REJECT_UNAUTHORIZED) === true || sslmode === 'verify-ca' || sslmode === 'verify-full';
  return { rejectUnauthorized: verify };
}


/** Production requires confirmation unless REQUIRE_EMAIL_CONFIRMATION=false (playtest, no SMTP). EMAIL_CONFIRM=1 still forces it on. */
export function emailConfirmationRequired(env: NodeJS.Dict<string> = process.env): boolean {
  const explicit = envFlag(env.REQUIRE_EMAIL_CONFIRMATION);
  if (explicit !== undefined) return explicit;
  return env.NODE_ENV === 'production' || env.EMAIL_CONFIRM === '1';
}

/** SPA fallback must not swallow Colyseus /matchmake or /health. */
export const SPA_FALLBACK = /^\/(?!api|health|matchmake).*/;

/** Empty ALLOWED_ORIGINS allows any origin, except on Render where we pin to RENDER_EXTERNAL_URL. */
export function allowedOrigins(env: NodeJS.Dict<string> = process.env): string[] {
  const listed = (env.ALLOWED_ORIGINS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (listed.length) return listed;
  const render = (env.RENDER_EXTERNAL_URL ?? '').replace(/\/$/, '');
  return render ? [render] : [];
}

const databaseUrl = req('DATABASE_URL');
export const config = {
  isProd,
  databaseUrl,
  port: resolvePort(),
  bindHost: resolveBindHost(),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 12),
  ssl: pgSslOption(databaseUrl),
};
