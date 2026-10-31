import type pg from 'pg';
import { CLASSES, applyExp, statsAt, validateAppearance, validateCharacterName, type ClassId } from '@astral/shared';
import { pool } from '../db/pool.js';
import { HttpError } from './auth.js';
export const MAX_CHARACTERS_PER_USER = 3;
const SPAWN = { map: 'asteria', x: 720, y: 698 }; // = asteria.json spawn (rounded)

export async function listCharacters(userId: string) {
  const r = await pool.query(`SELECT c.id,c.name,c.class,c.appearance,c.level,c.exp,c.gold,c.map_id,c.pos_x,c.pos_y,
    s.hp,s.max_hp,s.mp,s.max_mp,s.str,s.vit,s."int",s.agi,s.luk,s.atk,s.def,s.matk,s.mdef
    FROM characters c JOIN character_stats s ON s.character_id=c.id WHERE c.user_id=$1 AND c.deleted_at IS NULL ORDER BY c.created_at`, [userId]);
  return r.rows.map((x) => ({ ...x, exp: Number(x.exp), gold: Number(x.gold) }));
}
export async function createCharacter(userId: string, body: any) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'invalid_request');
  const n = validateCharacterName(body.name); if (!n.ok) throw new HttpError(400, `name_${n.error}`);
  if (!(body.class in CLASSES)) throw new HttpError(400, 'invalid_class');
  if (!validateAppearance(body.appearance)) throw new HttpError(400, 'invalid_appearance');
  const cls = body.class as ClassId; const st = statsAt(cls, 1);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]); // serialize per user (count limit)
    const cnt = (await c.query('SELECT count(*)::int n FROM characters WHERE user_id=$1 AND deleted_at IS NULL', [userId])).rows[0].n;
    if (cnt >= MAX_CHARACTERS_PER_USER) throw new HttpError(409, 'character_limit');
    const id = (await c.query(`INSERT INTO characters(user_id,name,class,appearance,map_id,pos_x,pos_y) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [userId, n.name, cls, body.appearance, SPAWN.map, SPAWN.x, SPAWN.y])).rows[0].id;
    await c.query(`INSERT INTO character_stats(character_id,hp,max_hp,mp,max_mp,str,vit,"int",agi,luk,atk,def,matk,mdef)
      VALUES($1,$2,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id, st.maxHp, st.maxMp, st.str, st.vit, st.int, st.agi, st.luk, st.atk, st.def, st.matk, st.mdef]);
    for (const sk of CLASSES[cls].startingSkills) await c.query('INSERT INTO character_skills(character_id,skill_id) VALUES($1,$2)', [id, sk]);
    await c.query('COMMIT');
    return (await listCharacters(userId)).find((x) => x.id === id)!;
  } catch (e: any) {
    await c.query('ROLLBACK');
    if (e.code === '23505') throw new HttpError(409, 'name_taken');
    throw e;
  } finally { c.release(); }
}

/**
 * Server-only EXP grant (no client endpoint). Idempotent by `idempotencyKey` via transactions UNIQUE.
 * Recomputes stats on level up and fully restores HP/MP on level up.
 */
export async function grantExp(characterId: string, amount: number, idempotencyKey: string, kind = 'exp_grant', db: pg.Pool = pool) {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const ch = (await c.query('SELECT level,exp,class FROM characters WHERE id=$1 FOR UPDATE', [characterId])).rows[0];
    if (!ch) throw new HttpError(404, 'character_not_found');
    const ins = await c.query(`INSERT INTO transactions(character_id,kind,idempotency_key,items_delta) VALUES($1,$2,$3,$4)
      ON CONFLICT (character_id,idempotency_key) DO NOTHING RETURNING id`, [characterId, kind, idempotencyKey, JSON.stringify([{ exp: amount }])]);
    if (!ins.rowCount) { await c.query('ROLLBACK'); return { applied: false as const }; }
    const before = statsAt(ch.class, ch.level);
    const r = applyExp(ch.level, Number(ch.exp), amount);
    await c.query('UPDATE characters SET level=$2,exp=$3,updated_at=now() WHERE id=$1', [characterId, r.level, r.exp]);
    let after = before;
    if (r.levelsGained > 0) {
      after = statsAt(ch.class, r.level);
      await c.query(`UPDATE character_stats SET max_hp=$2,hp=$2,max_mp=$3,mp=$3,str=$4,vit=$5,"int"=$6,agi=$7,luk=$8,atk=$9,def=$10,matk=$11,mdef=$12 WHERE character_id=$1`,
        [characterId, after.maxHp, after.maxMp, after.str, after.vit, after.int, after.agi, after.luk, after.atk, after.def, after.matk, after.mdef]);
    }
    await c.query('COMMIT');
    const diff = Object.fromEntries(Object.keys(after).map((k) => [k, (after as any)[k] - (before as any)[k]]).filter(([, v]) => v !== 0));
    return { applied: true as const, ...r, statDiff: diff };
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
