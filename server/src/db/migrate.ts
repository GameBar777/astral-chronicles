import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
const DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

/** Applies pending *.sql migrations in order, each inside its own transaction. */
export async function migrate(pool: pg.Pool, log = console.log): Promise<string[]> {
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(727001)');
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const applied: string[] = [];
    for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      await c.query('BEGIN');
      try {
        await c.query(readFileSync(DIR + f, 'utf8'));
        await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await c.query('COMMIT'); applied.push(f); log(`applied ${f}`);
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    }
    if (!applied.length) log('no pending migrations');
    return applied;
  } finally { await c.query('SELECT pg_advisory_unlock(727001)').catch(() => {}); c.release(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { pool } = await import('./pool.js');
  migrate(pool).then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
