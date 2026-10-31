// Generates assets/maps/asteria.json — TEMP placeholder layout for 3/4 top-down (oblique) view.
// Logic grid is orthogonal 32px; tall objects (houses/trees) have a ground FOOTPRINT used for collision,
// while their sprite extends upward and is Y-sorted by footprint bottom (see TECHNICAL_DECISIONS TD-005).
import { writeFileSync } from 'node:fs';
const W = 44, H = 34;
const T = { GRASS: 1, COBBLE: 2, DIRT: 3, WATER: 4 };
const ground = Array(W * H).fill(T.GRASS), col = Array(W * H).fill(0);
const g = (x, y, t) => { if (x >= 0 && y >= 0 && x < W && y < H) ground[y * W + x] = t; };
const objects = [];
const FOOT = { house: [5, 3], house_wide: [6, 3], tree: [1, 1], pine: [1, 1], fountain: [4, 3], fence_h: [1, 1], fence_v: [1, 1], barrel: [1, 1], lamp: [1, 1], stall: [3, 2], crate: [1, 1], sign: [1, 1], house_sign: [5, 3], flowers: [1, 1], bush: [1, 1], banner: [1, 1] };
// (tx,ty) = top-left tile of footprint
const obj = (kind, tx, ty, extra = {}) => {
  const [fw, fh] = FOOT[kind];
  objects.push({ id: `${kind}_${tx}_${ty}`, type: 'deco', kind, tx, ty, fw, fh, x: (tx + fw / 2) * 32, y: (ty + fh) * 32, ...extra });
  for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) col[y * W + x] = 1;
};
// cobblestone plaza (rounded) + roads
const cx = 22, cy = 17;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const d = Math.hypot((x - cx) / 1.25, y - cy);
  if (d < 8.5) g(x, y, T.COBBLE);
}
for (let x = 0; x < W; x++) for (const y of [16, 17, 18]) if (ground[y * W + x] === T.GRASS) g(x, y, x < 6 || x > W - 7 ? T.DIRT : T.COBBLE);
for (let y = 0; y < H; y++) for (const x of [21, 22, 23]) if (ground[y * W + x] === T.GRASS) g(x, y, y > H - 6 ? T.DIRT : T.COBBLE);
// pond SW
for (let y = 24; y < 30; y++) for (let x = 5; x < 12; x++) if (Math.hypot((x - 8.3) / 1.2, y - 26.8) < 2.9) { g(x, y, T.WATER); col[y * W + x] = 1; }
// buildings around the plaza
obj('house', 9, 6, { label: '冒険者ギルド' }); obj('house_wide', 28, 6, { label: '武器屋' });
obj('house_sign', 30, 22, { label: '宿屋' }); obj('house_wide', 8, 19, { label: '道具屋' });
obj('fountain', 20, 15);
obj('stall', 14, 12, { label: '露店' }); obj('crate', 13, 13); obj('barrel', 17, 12); obj('barrel', 15, 9);
obj('lamp', 19, 11); obj('lamp', 26, 11); obj('lamp', 19, 22); obj('lamp', 26, 22); obj('sign', 17, 21);
for (let x = 27; x < 35; x++) obj('fence_h', x, 13); for (let x = 9; x < 14; x++) obj('fence_h', x, 26 - 1 + 2);
for (let y = 24; y < 29; y++) obj('fence_v', 29, y);
// small props for density (flower beds beside doors, bushes, banners, barrels)
[[8, 9], [14, 9], [27, 9], [34, 9], [7, 22], [14, 22], [29, 21], [35, 25], [24, 12], [18, 25], [26, 26], [4, 20]].forEach(([x, y], i) => obj(i % 3 === 2 ? 'bush' : 'flowers', x, y));
obj('banner', 27, 22); obj('banner', 36, 8); obj('barrel', 12, 10); obj('barrel', 31, 10); obj('crate', 32, 10); obj('barrel', 13, 23);
// forest border: trees on the outer ring (2 tiles), gap for road exits
const exitAt = (x, y) => (y >= 16 && y <= 18) || (x >= 21 && x <= 23);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const edge = x < 2 || y < 2 || x >= W - 2 || y >= H - 2;
  if (edge && !exitAt(x, y) && (x + y * 3) % 2 === 0) obj((x * 7 + y) % 3 ? 'tree' : 'pine', x, y);
  else if (edge && !exitAt(x, y)) col[y * W + x] = 1; // solid hedge between trunks
}
// map edges solid except the east exit (portal to green_meadow, PHASE 3)
for (let x = 0; x < W; x++) { col[x] = 1; col[(H - 1) * W + x] = 1; } for (let y = 0; y < H; y++) { col[y * W] = 1; if (y < 16 || y > 18) col[y * W + W - 1] = 1; }
[[5, 10], [36, 17], [37, 27], [14, 29], [34, 3], [6, 14], [39, 10]].forEach(([x, y], i) => obj(i % 2 ? 'pine' : 'tree', x, y));
objects.push({ id: 'npc_guild_receptionist', type: 'npc', x: 11.5 * 32, y: 10.6 * 32, props: { name: 'ギルド受付 ミーナ' } });
// decorative townsfolk NPCs (static; no dialogue yet)
[['npc_guard_leon', 18.2, 19.4, '衛兵 レオン', 'knight'], ['npc_traveler_aria', 26.5, 16.2, '旅人 アリア', 'mage'], ['npc_smith_gord', 30.5, 10.6, '鍛冶屋 ゴルド', 'npc_smith'],
 // PHASE 5 service NPCs (single-image sprites npc_*.png)
 ['npc_shop_mira', 11.0, 23.0, '道具屋 ミラ', 'npc_shop'], ['npc_inn_hana', 31.5, 25.8, '宿屋 ハナ', 'npc_inn'], ['npc_chief_bram', 21.5, 13.6, '村長 ブラム', 'npc_chief']]
  .forEach(([id, x, y, name, sheet]) => objects.push({ id, type: 'npc', x: x * 32, y: y * 32, props: { name, sheet } }));
objects.push({ id: 'portal_to_meadow', type: 'portal', tx: W - 1, ty: 16, fw: 1, fh: 3, x: (W - 1) * 32, y: 17 * 32, props: { to: 'green_meadow', spawn: { x: 3.5 * 32, y: 17.6 * 32 } } });
objects.push({ id: 'sign_to_meadow', type: 'deco', kind: 'sign', tx: W - 4, ty: 14, fw: 1, fh: 1, x: (W - 3.5) * 32, y: 15 * 32, label: 'みどりの草原 →' }); col[14 * W + W - 4] = 1;
const map = { id: 'asteria', name: '始まりの街 アステリア', projection: 'oblique_3_4', width: W, height: H, tilewidth: 32, tileheight: 32,
  recommendedLevel: [1, 5], spawn: { x: 22.5 * 32, y: 21.8 * 32 },
  layers: [{ name: 'ground', data: ground }, { name: 'collision', data: col }], objects,
  _note: 'TEMP placeholder map generated by scripts/gen-asteria-map.mjs' };
writeFileSync(new URL('../assets/maps/asteria.json', import.meta.url), JSON.stringify(map));
console.log('wrote asteria.json', W, 'x', H, objects.length, 'objects');
