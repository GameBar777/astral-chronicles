import type { Direction, InputState, Vec2 } from './types.js';
export const PLAYER_SPEED = 120; // px/sec
/** Collision box of a 32x48 sprite: feet only (bottom-centered), so heads may overlap walls visually. */
export const PLAYER_HITBOX = { w: 20, h: 12 };

/** Normalised 8-direction vector; diagonals are not faster. */
export function inputToVector(i: InputState): Vec2 {
  const x = (i.right ? 1 : 0) - (i.left ? 1 : 0);
  const y = (i.down ? 1 : 0) - (i.up ? 1 : 0);
  if (x === 0 && y === 0) return { x: 0, y: 0 };
  const len = Math.hypot(x, y);
  return { x: x / len, y: y / len };
}
export function vectorToDirection(v: Vec2): Direction | null {
  if (v.x === 0 && v.y === 0) return null;
  const dirs: Direction[] = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];
  const a = Math.atan2(v.y, v.x);
  return dirs[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}
