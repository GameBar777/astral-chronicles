import { pool } from '../db/pool.js';
import { HttpError } from './auth.js';
/**
 * PHASE 9 rankings (read-only, computed from authoritative tables; cached 30 s to keep DB load flat).
 * level: level → exp → earliest creation. dungeon: number of cleared instances of ancient_ruins. guild: sum of member levels → members.
 */
const TTL = 30_000; const cache = new Map<string, { at: number; v: unknown }>();
export const __clearRankingCache = () => cache.clear();
const Q: Record<string, string> = {
  level: `SELECT c.id, c.name, c.class, c.level, c.exp::bigint exp, g.name guild FROM characters c LEFT JOIN guild_members m ON m.character_id=c.id LEFT JOIN guilds g ON g.id=m.guild_id
    WHERE c.deleted_at IS NULL ORDER BY c.level DESC, c.exp DESC, c.created_at LIMIT 50`,
  dungeon: `SELECT c.id, c.name, c.class, c.level, count(DISTINCT i.id)::int clears FROM dungeon_members dm JOIN dungeon_instances i ON i.id=dm.instance_id AND i.status='cleared'
    JOIN characters c ON c.id=dm.character_id WHERE c.deleted_at IS NULL GROUP BY c.id ORDER BY clears DESC, min(i.ended_at) LIMIT 50`,
  guild: `SELECT g.id, g.name, count(*)::int members, sum(c.level)::int score, max(CASE WHEN m.rank='leader' THEN c.name END) leader FROM guilds g JOIN guild_members m ON m.guild_id=g.id
    JOIN characters c ON c.id=m.character_id AND c.deleted_at IS NULL GROUP BY g.id ORDER BY score DESC, members DESC, g.created_at LIMIT 50`,
};
export async function ranking(kind: string) {
  const q = Q[kind]; if (!q) throw new HttpError(400, 'invalid_ranking');
  const hit = cache.get(kind); if (hit && Date.now() - hit.at < TTL) return hit.v;
  const rows = (await pool.query(q)).rows.map((r, i) => ({ rank: i + 1, ...r, exp: r.exp == null ? undefined : Number(r.exp) }));
  const v = { kind, rows, at: new Date().toISOString() }; cache.set(kind, { at: Date.now(), v }); return v;
}
