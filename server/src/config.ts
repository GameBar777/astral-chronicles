import { config as load } from 'dotenv';
import { fileURLToPath } from 'node:url';
load({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
function req(k: string): string { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; }
const isProd = process.env.NODE_ENV === 'production';
if (isProd && /CHANGE_ME|astral_dev_pw/.test(process.env.DATABASE_URL ?? '')) throw new Error('refusing to start: default DATABASE_URL password in production');
export const config = {
  isProd,
  databaseUrl: req('DATABASE_URL'),
  port: Number(process.env.SERVER_PORT ?? 2567),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 12),
};
