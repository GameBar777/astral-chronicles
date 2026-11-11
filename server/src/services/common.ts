import type pg from 'pg';
import { BattleError, ItemError } from '@astral/shared';
import { pool } from '../db/pool.js';
import { HttpError } from './auth.js';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONFLICT = new Set(['inventory_full', 'not_enough_gold', 'not_enough_materials', 'node_not_ready', 'craft_busy', 'not_ready', 'already_claimed', 'in_battle', 'equipped', 'max_enhance', 'two_handed', 'already_full', 'already_rewarded', 'quest_active', 'quest_done', 'quest_incomplete', 'quest_not_active', 'cannot_sell']);
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>, db: pg.Pool = pool) {
  const c = await db.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    if (e instanceof BattleError || e instanceof ItemError) throw new HttpError(CONFLICT.has(e.code) ? 409 : 400, e.code);
    throw e;
  } finally { c.release(); }
}
/** Owned, alive character; `lock` takes the row lock that serialises every state change of that character. */
export async function ownChar(c: pg.PoolClient, userId: string, characterId: unknown, lock = false) {
  if (typeof characterId !== 'string' || !UUID.test(characterId)) throw new HttpError(404, 'character_not_found');
  const r = await c.query(`SELECT c.id,c.name,c.class,c.appearance,c.level,c.exp,c.gold,c.map_id,c.pos_x,c.pos_y,c.pos_updated_at,s.* FROM characters c JOIN character_stats s ON s.character_id=c.id
    WHERE c.id=$1 AND c.user_id=$2 AND c.deleted_at IS NULL ${lock ? 'FOR UPDATE OF c' : ''}`, [characterId, userId]);
  if (!r.rows[0]) throw new HttpError(404, 'character_not_found');
  return r.rows[0];
}
const REQ = /^[A-Za-z0-9-]{8,64}$/;
/**
 * Idempotent mutation: the client sends a fresh requestId per user action. A resend of the same requestId
 * (double click, retry after timeout, reconnect) returns the stored result and changes nothing.
 * Caller must already hold the character row lock so two concurrent sends of one requestId serialise here.
 */
export async function idem<T extends object>(c: pg.PoolClient, characterId: string, requestId: unknown, kind: string, fn: () => Promise<T & { goldDelta?: number; itemsDelta?: unknown[] }>) {
  if (typeof requestId !== 'string' || !REQ.test(requestId)) throw new HttpError(400, 'invalid_request_id');
  const key = `req:${requestId}`;
  const prev = (await c.query('SELECT kind, result FROM transactions WHERE character_id=$1 AND idempotency_key=$2', [characterId, key])).rows[0];
  if (prev) { if (prev.kind !== kind) throw new HttpError(409, 'request_id_reused'); return { ...prev.result, replayed: true } as T & { replayed: boolean }; }
  const res = await fn();
  const { goldDelta = 0, itemsDelta = [], ...out } = res;
  await c.query(`INSERT INTO transactions(character_id,kind,gold_delta,items_delta,idempotency_key,result) VALUES($1,$2,$3,$4,$5,$6)`,
    [characterId, kind, goldDelta, JSON.stringify(itemsDelta), key, JSON.stringify(out)]);
  return { ...out, replayed: false } as unknown as T & { replayed: boolean };
}
export async function notInBattle(c: pg.PoolClient, characterId: string) {
  if ((await c.query("SELECT 1 FROM battle_logs WHERE character_id=$1 AND result IS NULL AND updated_at > now() - interval '30 minutes'", [characterId])).rowCount) throw new ItemError('in_battle');
}
