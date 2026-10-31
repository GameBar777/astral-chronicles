import type pg from 'pg';
import { isBlocked, PLAYER_SPEED, rollLoot, addGatherExp, gatherExpToNext, GATHER_RANGE, ItemError, type GatherType, type LootEntry } from '@astral/shared';
import { HttpError } from './auth.js';
import { tx, ownChar, idem, notInBattle } from './common.js';
import { addItem } from './inventory.js';
import { MAPS, npcPos } from '../world/maps.js';
let rng = Math.random; export const __setWorldRng = (r: () => number) => { rng = r; };
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
/** speed slack: network jitter + client frame batching. Anything faster is rejected and the client snaps back. */
export const SPEED_TOLERANCE = 1.35, SLACK_PX = 40, MAX_DT_SEC = 5;
export const posView = (ch: any) => ({ mapId: ch.map_id, x: ch.pos_x, y: ch.pos_y });
/**
 * Client reports where it walked to; server validates map, bounds, collision and speed, then stores it.
 * Map changes are NOT possible here (only through `usePortal`).
 */
export const updatePosition = (userId: string, characterId: unknown, body: any) => tx(async (c) => {
  const ch = await ownChar(c, userId, characterId, true);
  const x = num(body?.x), y = num(body?.y);
  if (body?.mapId !== ch.map_id) return { ok: false, reason: 'wrong_map', pos: posView(ch) };
  const map = MAPS[ch.map_id];
  if (!map || Number.isNaN(x) || Number.isNaN(y)) throw new HttpError(400, 'invalid_position');
  if (isBlocked(map, { x, y })) return { ok: false, reason: 'blocked', pos: posView(ch) };
  const dt = Math.min(MAX_DT_SEC, (Date.now() - new Date(ch.pos_updated_at).getTime()) / 1000);
  const dist = Math.hypot(x - ch.pos_x, y - ch.pos_y);
  if (dist > PLAYER_SPEED * dt * SPEED_TOLERANCE + SLACK_PX) return { ok: false, reason: 'too_fast', pos: posView(ch) };
  const rx = Math.round(x), ry = Math.round(y);
  await c.query('UPDATE characters SET pos_x=$2, pos_y=$3, pos_updated_at=now() WHERE id=$1', [ch.id, rx, ry]);
  return { ok: true, pos: { mapId: ch.map_id, x: rx, y: ry } };
});
const inRect = (o: any, x: number, y: number, pad = 24) => x >= o.tx * 32 - pad && x <= (o.tx + o.fw) * 32 + pad && y >= o.ty * 32 - pad && y <= (o.ty + o.fh) * 32 + pad;
export const usePortal = (userId: string, characterId: unknown, portalId: unknown) => tx(async (c) => {
  const ch = await ownChar(c, userId, characterId, true);
  await notInBattle(c, ch.id);
  const p = MAPS[ch.map_id]?.objects.find((o) => o.type === 'portal' && o.id === portalId);
  if (!p) throw new HttpError(404, 'portal_not_found');
  if (!inRect(p as any, ch.pos_x, ch.pos_y)) throw new HttpError(409, 'not_at_portal');
  const to = String(p.props?.to), sp = p.props?.spawn as { x: number; y: number };
  if (!MAPS[to]) throw new HttpError(500, 'portal_target_missing');
  await c.query('UPDATE characters SET map_id=$2, pos_x=$3, pos_y=$4, pos_updated_at=now() WHERE id=$1', [ch.id, to, Math.round(sp.x), Math.round(sp.y)]);
  return { pos: { mapId: to, x: Math.round(sp.x), y: Math.round(sp.y) } };
});
export function assertNear(ch: any, mapId: string, x: number, y: number, range: number) {
  if (ch.map_id !== mapId || Math.hypot(ch.pos_x - x, ch.pos_y - y) > range) throw new ItemError('too_far');
}
export function assertNearNpc(ch: any, npcId: string, range = 80) {
  const n = npcPos(ch.map_id, npcId); if (!n) throw new ItemError('too_far');
  assertNear(ch, ch.map_id, n.x, n.y, range);
}
export async function gatherState(userId: string, characterId: string) {
  return tx(async (c) => {
    const ch = await ownChar(c, userId, characterId);
    const nodes = (await c.query(`SELECT n.id, n.type, n.pos_x, n.pos_y, n.required_level, n.respawn_sec, s.available_at FROM gathering_nodes n
      LEFT JOIN gather_node_state s ON s.node_id=n.id AND s.character_id=$1 WHERE n.map_id=$2 ORDER BY n.id`, [ch.id, ch.map_id])).rows;
    const lv = ch.gathering_levels, ex = ch.gathering_exp;
    return { levels: Object.fromEntries(Object.keys(lv).map((k) => [k, { level: lv[k], exp: ex[k] ?? 0, toNext: gatherExpToNext(lv[k]) }])),
      nodes: nodes.map((n) => ({ id: n.id, type: n.type, x: n.pos_x, y: n.pos_y, requiredLevel: n.required_level, readyInSec: n.available_at ? Math.max(0, Math.ceil((new Date(n.available_at).getTime() - Date.now()) / 1000)) : 0 })) };
  });
}
/** Server rolls the loot. Node cooldown row + requestId make double sends harmless. */
export const gather = (userId: string, characterId: unknown, nodeId: unknown, requestId: unknown) => tx(async (c) => {
  const ch = await ownChar(c, userId, characterId, true);
  return idem(c, ch.id, requestId, 'gather', async () => {
    await notInBattle(c, ch.id);
    const n = (await c.query('SELECT * FROM gathering_nodes WHERE id=$1', [nodeId])).rows[0];
    if (!n) throw new HttpError(404, 'node_not_found');
    assertNear(ch, n.map_id, n.pos_x, n.pos_y - 16, GATHER_RANGE);
    const type = n.type as GatherType, lv = ch.gathering_levels[type] ?? 1;
    if (lv < n.required_level) throw new ItemError('gather_level_too_low');
    const st = (await c.query('SELECT available_at FROM gather_node_state WHERE character_id=$1 AND node_id=$2 FOR UPDATE', [ch.id, n.id])).rows[0];
    if (st && new Date(st.available_at).getTime() > Date.now()) throw new ItemError('node_not_ready');
    const loot = rollLoot(n.loot_table as LootEntry[], lv, rng);
    await addItem(c, ch.id, loot.itemId, loot.qty);
    const g = addGatherExp(lv, ch.gathering_exp[type] ?? 0, 4 + n.required_level * 2);
    await c.query(`UPDATE character_stats SET gathering_levels = jsonb_set(gathering_levels, $2, to_jsonb($3::int)), gathering_exp = jsonb_set(gathering_exp, $2, to_jsonb($4::int)) WHERE character_id=$1`,
      [ch.id, `{${type}}`, g.level, g.exp]);
    await c.query(`INSERT INTO gather_node_state(character_id,node_id,available_at) VALUES($1,$2,now() + make_interval(secs => $3))
      ON CONFLICT (character_id,node_id) DO UPDATE SET available_at=EXCLUDED.available_at`, [ch.id, n.id, n.respawn_sec]);
    const name = (await c.query('SELECT name FROM item_definitions WHERE id=$1', [loot.itemId])).rows[0].name;
    return { nodeId: n.id, type, item: { ...loot, name }, level: g.level, exp: g.exp, levelUp: g.level > lv, respawnSec: n.respawn_sec, itemsDelta: [loot] };
  });
});
