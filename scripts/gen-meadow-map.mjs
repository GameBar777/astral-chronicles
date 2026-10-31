// Generates assets/maps/green_meadow.json — 草原フィールド (Lv1-5). Same oblique 3/4 rules as asteria (TD-005).
import { writeFileSync } from 'node:fs';
const W = 48, H = 36;
const T = { GRASS: 1, COBBLE: 2, DIRT: 3, WATER: 4 };
const ground = Array(W * H).fill(T.GRASS), col = Array(W * H).fill(0);
const g = (x, y, t) => { if (x >= 0 && y >= 0 && x < W && y < H) ground[y * W + x] = t; };
const solid = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) col[y * W + x] = 1; };
const objects = [];
const FOOT = { oak: [2, 1], tree: [1, 1], pine: [1, 1], boulder: [2, 1], rocks: [1, 1], stump: [1, 1], signpost: [1, 1], berry_bush: [1, 1], bush: [1, 1], grass_tuft: [1, 1], wildflowers: [1, 1], flowers: [1, 1] };
const WALK = new Set(['grass_tuft', 'wildflowers', 'flowers']); // ground cover: no collision
const used = new Set();
const free = (tx, ty, fw, fh) => { for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) if (used.has(`${x},${y}`) || ground[y * W + x] !== T.GRASS || col[y * W + x]) return false; return true; };
const obj = (kind, tx, ty, extra = {}) => {
  const [fw, fh] = FOOT[kind];
  objects.push({ id: `${kind}_${tx}_${ty}`, type: 'deco', kind, tx, ty, fw, fh, x: (tx + fw / 2) * 32, y: (ty + fh) * 32, ...extra });
  for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) { used.add(`${x},${y}`); if (!WALK.has(kind)) solid(x, y); }
};
let s = 12345; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
// winding dirt road from the west gate (town) eastwards, with a branch north
for (let x = 0; x < W - 4; x++) {
  const cy = Math.round(17 + Math.sin(x / 6) * 2.2);
  for (let d = -1; d <= 1; d++) g(x, cy + d, T.DIRT);
  if (x % 5 === 0) g(x, cy + 2, T.DIRT);
}
for (let y = 3; y < 16; y++) { const cx = Math.round(30 + Math.sin(y / 3) * 1.5); g(cx, y, T.DIRT); g(cx + 1, y, T.DIRT); }
// pond (south-east) and small pool (north-west)
const pond = (px, py, rx, ry) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot((x - px) / rx, (y - py) / ry) < 1) { g(x, y, T.WATER); solid(x, y); } };
pond(36, 27, 4.6, 3.2); pond(11, 7, 3.2, 2.2);
// tree border (gap at west road = portal to town)
const westGate = (x, y) => x < 3 && y >= 15 && y <= 19;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const edge = x < 2 || y < 2 || x >= W - 2 || y >= H - 2;
  if (!edge || westGate(x, y)) continue;
  if ((x + y * 3) % 2 === 0 && !used.has(`${x},${y}`)) obj((x * 7 + y) % 3 ? 'tree' : 'pine', x, y); else solid(x, y);
}
for (let y = 0; y < H; y++) if (!(y >= 15 && y <= 19)) solid(0, y);
for (let x = 0; x < W; x++) { solid(x, 0); solid(x, H - 1); } for (let y = 0; y < H; y++) solid(W - 1, y);
// landmarks
obj('signpost', 5, 14, { label: '← アステリア' });
[[8, 22], [16, 9], [24, 26], [40, 8], [19, 30], [42, 18]].forEach(([x, y]) => free(x, y, 2, 1) && obj('oak', x, y));
[[14, 24], [27, 7], [38, 13], [22, 21]].forEach(([x, y]) => free(x, y, 2, 1) && obj('boulder', x, y));
// scatter: tree clumps, rocks, stumps, berry bushes, ground cover
const scatter = (kind, n) => { for (let i = 0, tries = 0; i < n && tries < 2000; tries++) {
  const [fw, fh] = FOOT[kind]; const x = 3 + Math.floor(rnd() * (W - 6)), y = 3 + Math.floor(rnd() * (H - 6));
  if (x < 7 && y > 12 && y < 22) continue; // keep entrance clear
  if (free(x, y, fw, fh)) { obj(kind, x, y); i++; } } };
scatter('tree', 7); scatter('pine', 4); scatter('rocks', 7); scatter('stump', 4); scatter('berry_bush', 6); scatter('bush', 5);
scatter('wildflowers', 26); scatter('grass_tuft', 34); scatter('flowers', 6);
// PHASE 4 gathering nodes (solid). Ids/positions must match server/migrations/004 gathering_nodes seed (checked by test).
export const NODES = [['node_copper_1', 'mining', 'node_copper', 12, 24], ['node_copper_2', 'mining', 'node_copper', 28, 30], ['node_iron_1', 'mining', 'node_iron', 44, 22],
  ['node_wood_1', 'logging', 'node_logging', 20, 26], ['node_wood_2', 'logging', 'node_logging', 40, 9],
  ['node_herb_1', 'herb', 'node_herb', 10, 10], ['node_herb_2', 'herb', 'node_herb', 24, 21], ['node_herb_3', 'herb', 'node_herb', 44, 28]];
for (const [id, type, kind, tx, ty] of NODES) { if (!free(tx, ty, 1, 1)) throw new Error(`node ${id} not free`); used.add(`${tx},${ty}`); solid(tx, ty);
  objects.push({ id, type: 'gather', kind, tx, ty, fw: 1, fh: 1, x: (tx + 0.5) * 32, y: (ty + 1) * 32, props: { gatherType: type } }); }
// portal back to town: walking into the west road edge
objects.push({ id: 'portal_to_asteria', type: 'portal', tx: 0, ty: 15, fw: 1, fh: 5, x: 16, y: 17.5 * 32, props: { to: 'asteria', spawn: { x: 41.5 * 32, y: 17.6 * 32 } } });
// monster symbols roam inside this rect (tiles); server picks actual encounter (lead = touched symbol)
objects.push({ id: 'spawn_meadow', type: 'spawn', tx: 8, ty: 4, fw: 36, fh: 28, x: 0, y: 0, props: { zone: 'green_meadow', count: 7, monsters: ['slime', 'horn_rabbit', 'mushroom', 'goblin', 'wild_dog'] } });
const map = { id: 'green_meadow', name: 'みどりの草原', projection: 'oblique_3_4', width: W, height: H, tilewidth: 32, tileheight: 32,
  recommendedLevel: [1, 5], spawn: { x: 3.5 * 32, y: 17.6 * 32 }, layers: [{ name: 'ground', data: ground }, { name: 'collision', data: col }], objects,
  _note: 'generated by scripts/gen-meadow-map.mjs' };
writeFileSync(new URL('../assets/maps/green_meadow.json', import.meta.url), JSON.stringify(map));
console.log('wrote green_meadow.json', W, 'x', H, objects.length, 'objects');
