import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
export async function resetDb() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool, () => {});
}
