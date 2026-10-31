import type { MapData, Vec2 } from './types.js';
import { PLAYER_HITBOX } from './movement.js';

export function collisionLayer(map: MapData): number[] {
  const l = map.layers.find((l) => l.name === 'collision');
  if (!l) throw new Error(`map ${map.id} has no collision layer`);
  if (l.data.length !== map.width * map.height) throw new Error(`map ${map.id} collision size mismatch`);
  return l.data;
}
export function isTileBlocked(map: MapData, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return true; // outside = wall
  return collisionLayer(map)[ty * map.width + tx] !== 0;
}
/** pos = feet center. Checks every tile the hitbox overlaps. */
export function isBlocked(map: MapData, pos: Vec2, box = PLAYER_HITBOX): boolean {
  const l = pos.x - box.w / 2, r = pos.x + box.w / 2 - 0.001;
  const t = pos.y - box.h, b = pos.y - 0.001;
  for (let ty = Math.floor(t / map.tileheight); ty <= Math.floor(b / map.tileheight); ty++)
    for (let tx = Math.floor(l / map.tilewidth); tx <= Math.floor(r / map.tilewidth); tx++)
      if (isTileBlocked(map, tx, ty)) return true;
  return false;
}
/** Axis-separated move so the player slides along walls. Same function runs on client & server. */
export function moveWithCollision(map: MapData, pos: Vec2, delta: Vec2): Vec2 {
  let out = { ...pos };
  // sub-step to avoid tunnelling with large deltas
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(delta.x), Math.abs(delta.y)) / 4));
  for (let i = 0; i < steps; i++) {
    const nx = { x: out.x + delta.x / steps, y: out.y };
    if (!isBlocked(map, nx)) out = nx;
    const ny = { x: out.x, y: out.y + delta.y / steps };
    if (!isBlocked(map, ny)) out = ny;
  }
  return out;
}
