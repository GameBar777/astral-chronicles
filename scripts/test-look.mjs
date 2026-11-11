/** BUG-008 regression: hair style/color and mage-hood isolation, run with
 *   node --import tsx scripts/test-look.mjs   (pngjs resolved from /tmp/pngt or node_modules)
 */
import { PNG } from 'pngjs';
import fs from 'node:fs';
import { applyLook, dirOf, FW, FH } from '../client/src/art/lookcore.ts';
import { HAIR, SKIN } from '../client/src/art/placeholderArt.ts';
const S = (process.env.ASTRAL_ROOT ?? new URL('..', import.meta.url).pathname) + '/client/public/sprites/';
const results = []; const ok = (n, c, i = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${i}`); };
const load = (cls) => PNG.sync.read(fs.readFileSync(S + `char_${cls}.png`));
const clone = (p) => { const d = new Uint8ClampedArray(p.data); return { width: p.width, height: p.height, data: d }; };
const px = (im, f, x, y) => { const i = (y * im.width + f * FW + x) * 4; return [im.data[i], im.data[i+1], im.data[i+2], im.data[i+3]]; };
const dist = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
const hairHex = (i) => { const h = HAIR[i]; return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; };

for (const cls of ['warrior', 'knight', 'priest', 'mage']) {
  const base = load(cls);
  const recolor = clone(base);
  applyLook(recolor.data, base.width, base.height, cls, { hairColor: 4, hairStyle: 0 }, HAIR, SKIN); // blue
  const styled = clone(base);
  applyLook(styled.data, base.width, base.height, cls, { hairColor: 4, hairStyle: 1 }, HAIR, SKIN); // long + blue
  // some pixel in the hair region must move toward the target hair colour
  let shifted = 0, same = 0;
  const target = hairHex(4);
  for (let f = 0; f < 4; f++) for (let y = 0; y < 28; y++) for (let x = 8; x < 40; x++) {
    const a = px(base, f, x, y), b = px(recolor, f, x, y);
    if (a[3] < 100) continue;
    if (dist(a, b) > 25) { shifted++; if (dist(b, target) + 20 < dist(a, target)) same++; }
  }
  ok(`${cls} hair recolour moves pixels toward palette`, shifted > 20 && same > shifted * 0.3, `shifted=${shifted} toward=${same}`);

  // long style must change or add pixels in the lower-head / upper-torso band vs colour-only
  let added = 0;
  for (let f = 0; f < 4; f++) for (let y = 22; y < 50; y++) for (let x = 4; x < 44; x++) {
    const a = px(recolor, f, x, y), b = px(styled, f, x, y);
    if (dist(a, b) > 20 || (a[3] < 100 && b[3] >= 200)) added++;
  }
  ok(`${cls} long style adds hair below the head`, added >= 8, `added=${added}`);

  if (cls === 'mage') {
    // hood isolation: robe (lower body) pixels must stay the same under hair recolour
    let robeChanged = 0, robe = 0;
    for (let f = 0; f < 4; f++) for (let y = 40; y < FH; y++) for (let x = 0; x < FW; x++) {
      const a = px(base, f, x, y), b = px(recolor, f, x, y);
      if (a[3] < 100) continue; robe++;
      if (dist(a, b) > 8) robeChanged++;
    }
    ok('mage robe/hood body unchanged by hair recolour', robeChanged < robe * 0.01, `changed=${robeChanged}/${robe}`);
    // fringe style 3 should change some pixels inside the hood opening (front), not the back hood silhouette top
    const fringe = clone(base), re5 = clone(base);
    applyLook(re5.data, base.width, base.height, cls, { hairColor: 5, hairStyle: 0 }, HAIR, SKIN);
    applyLook(fringe.data, base.width, base.height, cls, { hairColor: 5, hairStyle: 3 }, HAIR, SKIN);
    let frontChanged = 0, backTopChanged = 0;
    for (let y = 8; y < 22; y++) for (let x = 14; x < 34; x++) {
      if (dist(px(re5, 0, x, y), px(fringe, 0, x, y)) > 20) frontChanged++;
      if (dist(px(re5, 3, x, y), px(fringe, 3, x, y)) > 20) backTopChanged++;
    }
    ok('mage 前髪 changes the front opening', frontChanged >= 4, `front=${frontChanged}`);
    ok('mage 前髪 does not paint the back of the hood', backTopChanged < 10, `back=${backTopChanged}`);
  }
}
const fail = results.filter((x) => !x).length;
console.log(`${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
