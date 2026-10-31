import { describe, it, expect, afterAll } from 'vitest';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
const REQUIRED = ['users','characters','character_stats','character_equipment','inventory','item_definitions','equipment_definitions',
  'monster_definitions','monster_drops','quests','character_quests','skills','character_skills','recipes','gathering_nodes','parties',
  'party_members','friends','guilds','guild_members','chat_messages','dungeon_instances','battle_logs','transactions','enhancement_logs'];
afterAll(() => pool.end());
describe('database schema', () => {
  it('migrations apply and are idempotent', async () => {
    await migrate(pool, () => {});
    expect(await migrate(pool, () => {})).toEqual([]);
  });
  it('all SECTION 19 tables exist with primary keys', async () => {
    const r = await pool.query(`SELECT t.table_name, EXISTS(SELECT 1 FROM information_schema.table_constraints c
      WHERE c.table_name=t.table_name AND c.constraint_type='PRIMARY KEY') pk
      FROM information_schema.tables t WHERE t.table_schema='public'`);
    const m = new Map(r.rows.map((x) => [x.table_name, x.pk]));
    for (const t of REQUIRED) { expect(m.has(t), t).toBe(true); expect(m.get(t), `${t} pk`).toBe(true); }
  });
  it('constraints enforced: unique name (case-insensitive), FK, double-reward key', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const u = (await c.query(`INSERT INTO users(email,password_hash) VALUES('t@example.test','x') RETURNING id`)).rows[0].id;
      const ch = (await c.query(`INSERT INTO characters(user_id,name,class) VALUES($1,'Hero','warrior') RETURNING id`, [u])).rows[0].id;
      await c.query('SAVEPOINT a');
      await expect(c.query(`INSERT INTO characters(user_id,name,class) VALUES($1,'hero','mage')`, [u])).rejects.toThrow(/ux_characters_name_ci/);
      await c.query('ROLLBACK TO a');
      await expect(c.query(`INSERT INTO inventory(character_id,item_id) VALUES($1,'no_such_item')`, [ch])).rejects.toThrow(/foreign key/);
      await c.query('ROLLBACK TO a');
      await c.query(`INSERT INTO transactions(character_id,kind,gold_delta,idempotency_key) VALUES($1,'battle_reward',10,'b1')`, [ch]);
      await expect(c.query(`INSERT INTO transactions(character_id,kind,gold_delta,idempotency_key) VALUES($1,'battle_reward',10,'b1')`, [ch])).rejects.toThrow(/duplicate key/);
      await c.query('ROLLBACK TO a');
      await expect(c.query(`UPDATE characters SET gold=-1 WHERE id=$1`, [ch])).rejects.toThrow(/check constraint/);
    } finally { await c.query('ROLLBACK'); c.release(); }
  });
});
