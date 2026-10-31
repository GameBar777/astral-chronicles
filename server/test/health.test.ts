import { describe, it, expect, afterAll } from 'vitest';
import { createGameServer } from '../src/app.js';
import { pool } from '../src/db/pool.js';
describe('server boot', () => {
  const { gameServer } = createGameServer();
  afterAll(async () => { await gameServer.gracefullyShutdown(false); await pool.end().catch(() => {}); });
  it('listens and /health reports db up', async () => {
    await gameServer.listen(25670);
    const r = await fetch('http://127.0.0.1:25670/health');
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ ok: true, db: 'up' });
  });
});
