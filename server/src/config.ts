import { config as load } from 'dotenv';
import { fileURLToPath } from 'node:url';
load({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
function req(k: string): string { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; }
export const config = {
  databaseUrl: req('DATABASE_URL'),
  port: Number(process.env.SERVER_PORT ?? 2567),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 12),
};
