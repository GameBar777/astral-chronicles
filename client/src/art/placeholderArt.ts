/**
 * TEMP placeholder pixel art, generated procedurally at runtime (original, no third-party assets).
 * Style target: 3/4 top-down 16-bit fantasy town. Replace with hand-made sprite sheets later (SECTION 02).
 */
import Phaser from 'phaser';
type Ctx = CanvasRenderingContext2D;
let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const px = (c: Ctx, x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(x | 0, y | 0, w | 0, h | 0); };
function canvas(scene: Phaser.Scene, key: string, w: number, h: number, draw: (c: Ctx) => void) {
  const t = scene.textures.createCanvas(key, w, h)!; const c = t.getContext(); c.imageSmoothingEnabled = false; draw(c); t.refresh(); return t;
}
// ---------- tiles (index 1..4) ----------
function grass(c: Ctx, ox: number) {
  px(c, ox, 0, 32, 32, '#5f9a3a');
  for (let i = 0; i < 40; i++) px(c, ox + rnd() * 31, rnd() * 31, 1, 2, rnd() < 0.5 ? '#4f8530' : '#73ad48');
  for (let i = 0; i < 3; i++) px(c, ox + rnd() * 30, rnd() * 30, 2, 1, '#8cc25a');
  if (rnd() < 0.4) { const x = ox + 4 + rnd() * 24, y = 4 + rnd() * 24; px(c, x, y, 1, 1, '#f4e27a'); px(c, x + 1, y + 1, 1, 1, '#ffffff'); }
}
function cobble(c: Ctx, ox: number) {
  px(c, ox, 0, 32, 32, '#6d6457');
  const rows = [[0, 9], [9, 8], [17, 8], [25, 7]];
  rows.forEach(([y, h], r) => {
    let x = r % 2 ? -5 : 0;
    while (x < 32) {
      const w = 8 + Math.floor(rnd() * 5);
      const tone = ['#a99d88', '#b3a891', '#9d927e', '#bcb19a'][Math.floor(rnd() * 4)];
      const x0 = Math.max(0, x + 1), x1 = Math.min(32, x + w - 1);
      if (x1 > x0) { px(c, ox + x0, y + 1, x1 - x0, h - 2, tone); px(c, ox + x0, y + 1, x1 - x0, 1, '#cfc6b0'); px(c, ox + x0, y + h - 2, x1 - x0, 1, '#7f7564'); }
      x += w;
    }
  });
}
function dirt(c: Ctx, ox: number) {
  px(c, ox, 0, 32, 32, '#a5814f');
  for (let i = 0; i < 35; i++) px(c, ox + rnd() * 31, rnd() * 31, 2, 1, rnd() < 0.5 ? '#8f6d40' : '#b99460');
}
function water(c: Ctx, ox: number) {
  px(c, ox, 0, 32, 32, '#2f6fb0');
  for (let i = 0; i < 6; i++) { const y = rnd() * 30, x = rnd() * 24; px(c, ox + x, y, 6, 1, '#5d9be0'); px(c, ox + x + 2, y + 1, 3, 1, '#9cc8f2'); }
}
// ---------- objects ----------
function tree(c: Ctx, pine: boolean) { // 64x96, trunk at bottom center
  c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); c.ellipse(32, 90, 20, 6, 0, 0, Math.PI * 2); c.fill();
  px(c, 28, 66, 8, 26, '#5b3a1e'); px(c, 28, 66, 2, 26, '#7a5230'); px(c, 34, 66, 2, 26, '#3f2814');
  if (pine) {
    for (let i = 0; i < 4; i++) { const w = 18 + i * 7, y = 8 + i * 16;
      c.fillStyle = '#1f5a2c'; c.beginPath(); c.moveTo(32, y - 6); c.lineTo(32 - w, y + 20); c.lineTo(32 + w, y + 20); c.fill();
      c.fillStyle = '#2f7a3a'; c.beginPath(); c.moveTo(32, y - 4); c.lineTo(32 - w + 6, y + 17); c.lineTo(32, y + 17); c.fill(); }
  } else {
    const blob = (x: number, y: number, r: number, col: string) => { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
    blob(32, 44, 26, '#1f5a26'); blob(20, 52, 16, '#1f5a26'); blob(44, 52, 16, '#1f5a26');
    blob(30, 38, 21, '#2f7d32'); blob(20, 48, 12, '#2f7d32'); blob(42, 47, 12, '#2f7d32');
    blob(25, 30, 10, '#45a043'); blob(38, 34, 7, '#45a043');
    for (let i = 0; i < 25; i++) px(c, 12 + rnd() * 40, 20 + rnd() * 40, 2, 2, rnd() < 0.5 ? '#5cb853' : '#174a1e');
  }
}
function house(c: Ctx, w: number, d: number) { // footprint w x d tiles. sprite = w*32 x (d*32 + 64)
  const W = w * 32, H = d * 32 + 64, wallH = 70, wallTop = H - wallH;
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(4, H - 6, W - 4, 6);
  // front wall: stone base + timber frame upper
  px(c, 2, wallTop, W - 4, wallH, '#e8dcc0');
  for (let y = H - 30; y < H; y += 6) for (let x = 2 + ((y / 6) % 2) * 5; x < W - 2; x += 10) { px(c, x, y, 9, 5, '#9a9488'); px(c, x, y, 9, 1, '#bdb8ac'); }
  px(c, 2, H - 31, W - 4, 2, '#5a3a20');
  for (let x = 2; x < W - 2; x += 26) px(c, x, wallTop, 4, wallH - 30, '#6b4424');
  px(c, 2, wallTop, W - 4, 4, '#6b4424');
  px(c, W - 10, wallTop, 8, wallH, 'rgba(0,0,0,0.18)'); // side shade
  // door
  const dx = W / 2 - 10; px(c, dx - 2, H - 34, 24, 34, '#4a3020'); px(c, dx, H - 32, 20, 32, '#7a4a28');
  for (let x = dx + 4; x < dx + 20; x += 5) px(c, x, H - 32, 1, 32, '#5a3418'); px(c, dx + 15, H - 17, 2, 3, '#e6c24a');
  // windows + flower boxes
  for (const wx of [14, W - 34]) { px(c, wx - 2, wallTop + 10, 24, 20, '#4a3020'); px(c, wx, wallTop + 12, 20, 16, '#7fb6d8');
    px(c, wx + 9, wallTop + 12, 2, 16, '#4a3020'); px(c, wx, wallTop + 19, 20, 2, '#4a3020'); px(c, wx + 2, wallTop + 13, 5, 3, '#cfe8f6');
    px(c, wx - 2, wallTop + 30, 24, 5, '#6b4424'); for (let i = 0; i < 6; i++) px(c, wx + i * 4, wallTop + 27, 3, 3, i % 2 ? '#e05a6a' : '#f2d04a'); }
  // roof (visible top plane in 3/4 view), overhangs wall
  const roofH = wallTop + 6;
  for (let y = 0; y < roofH; y++) {
    const shade = y < 6 ? '#7a2418' : y % 8 < 1 ? '#7e2a1c' : (y / 8) % 2 < 1 ? '#b8442c' : '#a83c26';
    px(c, 0, y, W, 1, shade);
  }
  for (let y = 8; y < roofH; y += 8) for (let x = ((y / 8) % 2) * 6; x < W; x += 12) px(c, x, y - 7, 1, 7, '#8a301e');
  px(c, 0, 0, W, 3, '#5a1a10'); px(c, 0, roofH - 3, W, 3, '#5a1a10');
  px(c, 0, 0, 3, roofH, '#5a1a10'); px(c, W - 3, 0, 3, roofH, '#5a1a10');
  px(c, W - 40, 0, 40, roofH, 'rgba(0,0,0,0.12)');
  // chimney
  px(c, W - 30, 2, 14, 22, '#7d776c'); px(c, W - 32, 0, 18, 5, '#5f5a51'); for (let y = 8; y < 24; y += 5) px(c, W - 30, y, 14, 1, '#5f5a51');
}
function fountain(c: Ctx) { // 128x112 footprint 4x3
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(64, 100, 60, 12, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#7d776c'; c.beginPath(); c.ellipse(64, 78, 62, 26, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#a49d90'; c.beginPath(); c.ellipse(64, 72, 60, 24, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#2f78c0'; c.beginPath(); c.ellipse(64, 72, 50, 18, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#5aa6ea'; c.beginPath(); c.ellipse(60, 70, 34, 10, 0, 0, Math.PI * 2); c.fill();
  px(c, 4, 78, 120, 14, '#8f887b'); for (let x = 6; x < 122; x += 12) { px(c, x, 80, 10, 10, '#b3ac9e'); px(c, x, 80, 10, 1, '#d0cabd'); }
  px(c, 56, 30, 16, 42, '#a49d90'); px(c, 56, 30, 4, 42, '#c3bdb0'); px(c, 46, 26, 36, 8, '#8f887b');
  for (let i = 0; i < 30; i++) px(c, 50 + rnd() * 28, 4 + rnd() * 26, 2, 3, rnd() < 0.5 ? '#9cd4ff' : '#e8f6ff');
}
function fence(c: Ctx, vertical: boolean) { // 32x48
  if (vertical) { px(c, 13, 0, 6, 46, '#6b4424'); px(c, 13, 0, 2, 46, '#8a5c34'); return; }
  px(c, 0, 26, 32, 5, '#6b4424'); px(c, 0, 36, 32, 5, '#6b4424'); px(c, 0, 26, 32, 1, '#8a5c34');
  for (const x of [2, 24]) { px(c, x, 18, 6, 30, '#5a3a20'); px(c, x, 18, 2, 30, '#8a5c34'); }
}
function barrel(c: Ctx) { // 32x40
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(5, 36, 22, 4);
  px(c, 6, 6, 20, 32, '#8a5a2c'); px(c, 4, 10, 24, 24, '#8a5a2c'); px(c, 8, 6, 3, 32, '#a8743e');
  px(c, 4, 12, 24, 2, '#3f3a34'); px(c, 4, 28, 24, 2, '#3f3a34'); px(c, 7, 4, 18, 4, '#6b4424');
}
function crate(c: Ctx) { px(c, 3, 10, 26, 26, '#a87a44'); px(c, 3, 10, 26, 3, '#c89a5e'); c.strokeStyle = '#6b4424'; c.lineWidth = 2; c.strokeRect(4, 11, 24, 24); c.beginPath(); c.moveTo(4, 11); c.lineTo(28, 35); c.stroke(); }
function lamp(c: Ctx) { // 32x80
  px(c, 14, 20, 4, 58, '#2e2e34'); px(c, 10, 74, 12, 6, '#2e2e34'); px(c, 8, 6, 16, 16, '#2e2e34'); px(c, 10, 8, 12, 12, '#ffd36a'); px(c, 12, 10, 4, 4, '#fff4c2'); px(c, 6, 4, 20, 3, '#1e1e24');
}
function stall(c: Ctx) { // 96x96 footprint 3x2
  px(c, 4, 50, 88, 40, '#8a5a2c'); px(c, 4, 50, 88, 4, '#a8743e');
  for (let i = 0; i < 6; i++) px(c, 10 + i * 14, 44, 10, 8, ['#e05a3a', '#f2d04a', '#7ac05a', '#c07ad0'][i % 4]);
  px(c, 6, 16, 4, 70, '#5a3a20'); px(c, 86, 16, 4, 70, '#5a3a20');
  for (let x = 0; x < 96; x += 12) px(c, x, 6, 12, 22, (x / 12) % 2 ? '#f2efe6' : '#c83a2e');
  for (let x = 0; x < 96; x += 12) { c.fillStyle = (x / 12) % 2 ? '#f2efe6' : '#c83a2e'; c.beginPath(); c.arc(x + 6, 28, 6, 0, Math.PI); c.fill(); }
}
function sign(c: Ctx) { px(c, 14, 14, 4, 34, '#5a3a20'); px(c, 2, 8, 28, 12, '#8a5a2c'); px(c, 2, 8, 28, 2, '#a8743e'); px(c, 6, 13, 18, 1, '#4a3020'); }

// ---------- characters 32x48: 8 directions x 3 walk frames ----------
export const HAIR = ['#3a2416', '#8a5a2a', '#e8c45a', '#c8462e', '#5a6ad0', '#e8e8f0'];
export const SKIN = ['#f6d2b0', '#e8b48c', '#c48a5e', '#8a5a3a'];
export const CLASS_COLORS: Record<string, [string, string]> = { warrior: ['#a8342a', '#6b1e18'], knight: ['#8a96a8', '#4a5668'], mage: ['#5a3a9a', '#34205e'], priest: ['#f0ead8', '#b8ae94'], npc: ['#3a8a6a', '#205a44'] };
const DIRS: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
export function characterTexture(scene: Phaser.Scene, key: string, look: { cls: string; hair: number; skin: number; body: 'a' | 'b'; hairStyle: number }) {
  if (scene.textures.exists(key)) return key;
  const [main, dark] = CLASS_COLORS[look.cls] ?? CLASS_COLORS.npc;
  const hair = HAIR[look.hair] ?? HAIR[0], skin = SKIN[look.skin] ?? SKIN[0];
  const t = canvas(scene, key, 32 * 24, 48, (c) => {
    DIRS.forEach(([dx, dy], d) => { for (let f = 0; f < 3; f++) {
      const ox = (d * 3 + f) * 32, step = f === 0 ? 0 : f === 1 ? 1 : -1, bob = f === 0 ? 0 : 1, back = dy < 0, side = dx !== 0 && dy === 0;
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(ox + 16, 45, 9, 3, 0, 0, Math.PI * 2); c.fill();
      // legs
      px(c, ox + 11, 36 - bob, 4, 9 + (step > 0 ? -2 : 0), '#3a2a20'); px(c, ox + 17, 36 - bob, 4, 9 + (step < 0 ? -2 : 0), '#3a2a20');
      px(c, ox + 10, 43 + (step > 0 ? -2 : 0), 6, 2, '#2a1a10'); px(c, ox + 16, 43 + (step < 0 ? -2 : 0), 6, 2, '#2a1a10');
      // body / robe
      const robe = look.cls === 'mage' || look.cls === 'priest';
      px(c, ox + 9, 22 - bob, 14, robe ? 18 : 15, main); px(c, ox + 9, 22 - bob, 14, 2, dark); px(c, ox + 20, 22 - bob, 3, robe ? 18 : 15, dark);
      if (look.body === 'b') px(c, ox + 10, 31 - bob, 12, 2, dark);
      px(c, ox + 9, 33 - bob, 14, 2, '#5a3a20');
      // arms (swing)
      px(c, ox + 6, 23 - bob + step, 3, 10, main); px(c, ox + 23, 23 - bob - step, 3, 10, main);
      px(c, ox + 6, 32 - bob + step, 3, 2, skin); px(c, ox + 23, 32 - bob - step, 3, 2, skin);
      // head
      px(c, ox + 9, 8 - bob, 14, 14, skin); px(c, ox + 8, 10 - bob, 16, 10, skin);
      px(c, ox + 8, 6 - bob, 16, back ? 14 : 6, hair); px(c, ox + 7, 8 - bob, 2, look.hairStyle % 2 ? 14 : 8, hair); px(c, ox + 23, 8 - bob, 2, look.hairStyle % 2 ? 14 : 8, hair);
      if (look.hairStyle >= 2) px(c, ox + 10, 4 - bob, 12, 3, hair);
      if (!back) { const ex = side ? (dx > 0 ? 18 : 11) : 12 + dx; px(c, ox + ex, 14 - bob, 2, 3, '#1a1010'); if (!side) px(c, ox + ex + 6, 14 - bob, 2, 3, '#1a1010'); }
      // class accents
      if (look.cls === 'knight') { px(c, ox + 8, 5 - bob, 16, 4, '#c0c8d4'); px(c, ox + (dx >= 0 ? 23 : 3), 24 - bob, 6, 10, '#3a5aa8'); }
      if (look.cls === 'warrior') px(c, ox + (dx >= 0 ? 25 : 4), 14 - bob, 2, 18, '#d0d4dc');
      if (look.cls === 'mage') { px(c, ox + 7, 2 - bob, 18, 4, '#34205e'); px(c, ox + 12, -2 - bob + 2, 8, 3, '#34205e'); px(c, ox + (dx >= 0 ? 26 : 4), 10 - bob, 2, 26, '#8a5a2a'); px(c, ox + (dx >= 0 ? 25 : 3), 8 - bob, 4, 4, '#6ad0ff'); }
      if (look.cls === 'priest') { px(c, ox + 15, 24 - bob, 2, 8, '#e6c24a'); px(c, ox + 13, 26 - bob, 6, 2, '#e6c24a'); }
      // outline-ish bottom shade
      px(c, ox + 9, 21 - bob, 14, 1, 'rgba(0,0,0,0.25)');
    } });
  });
  for (let i = 0; i < 24; i++) t.add(i, 0, i * 32, 0, 32, 48);
  return key;
}
export const DIR_INDEX = { e: 0, se: 1, s: 2, sw: 3, w: 4, nw: 5, n: 6, ne: 7 } as const;

export function generateWorldArt(scene: Phaser.Scene) {
  seed = 7;
  canvas(scene, 'tiles', 32 * 5, 32, (c) => { grass(c, 32); cobble(c, 64); dirt(c, 96); water(c, 128); });
  canvas(scene, 'obj_tree', 64, 96, (c) => tree(c, false));
  canvas(scene, 'obj_pine', 64, 96, (c) => tree(c, true));
  canvas(scene, 'obj_house', 160, 3 * 32 + 64, (c) => house(c, 5, 3));
  canvas(scene, 'obj_house_wide', 192, 3 * 32 + 64, (c) => house(c, 6, 3));
  canvas(scene, 'obj_fountain', 128, 112, fountain);
  canvas(scene, 'obj_fence_h', 32, 48, (c) => fence(c, false));
  canvas(scene, 'obj_fence_v', 32, 48, (c) => fence(c, true));
  canvas(scene, 'obj_barrel', 32, 40, barrel);
  canvas(scene, 'obj_crate', 32, 40, crate);
  canvas(scene, 'obj_lamp', 32, 80, lamp);
  canvas(scene, 'obj_stall', 96, 96, stall);
  canvas(scene, 'obj_sign', 32, 48, sign);
}
