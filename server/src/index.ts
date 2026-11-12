import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { createGameServer } from './app.js';
// LOADTEST_AUTH_LIMIT: raise the per-IP auth rate limit for local load tests only (ignored in production)
const authLimit = !config.isProd && process.env.LOADTEST_AUTH_LIMIT ? Number(process.env.LOADTEST_AUTH_LIMIT) : undefined;
await migrate(pool);
const { gameServer } = createGameServer(authLimit ? { authLimit, createLimit: authLimit } : undefined);
await gameServer.listen(config.port, config.bindHost);
console.log(`[astral] server listening on ${config.bindHost}:${config.port}`);
