/**
 * BUG-008 (closed in the follow-up): pure pixel logic for character appearance, no Phaser/DOM so it is unit-testable in node.
 * Works on the 48×60 frame class sheets (frame order: 0 front, 1 left, 2 right, 3 back, 4..11 walk = 4+2*dir).
 *  - skin recolour (face area), hair recolour (per-class hue window; mage: the purple locks/fringe inside the hood opening)
 *  - hair STYLE as pixel overlays drawn in the hair colour: 0 標準 / 1 ロング / 2 ポニーテール / 3 ツンツン (mage: 3 = 前髪)
 *  - body type "b" handled by the caller (horizontal widen)
 */
export type Look = { bodyType?: string; hairStyle?: number; hairColor?: number; skinColor?: number };
export const HAIR_STYLE_NAMES = ['標準', 'ロング', 'ポニーテール', 'ツンツン'];
export const FW = 48, FH = 60;
type RGB = [number, number, number];
/** [hueMin, hueMax, satMin, xMin, xMax, yMax] of the class's drawn hair; mage = hood case */
const CFG: Record<string, [number, number, number, number, number, number] | null> = {
  warrior: [0, 40, 0.35, 10, 38, 24], knight: [25, 60, 0.3, 10, 38, 22], priest: [25, 60, 0.3, 12, 38, 24], mage: null };
export const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
export function rgb2hls(r: number, g: number, b: number): RGB {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; if (mx === mn) return [0, l, 0];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [h / 6, l, s];
}
export function hls2rgb(h: number, l: number, s: number): RGB {
  if (s === 0) return [l, l, l]; const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
export const dirOf = (f: number) => (['front', 'left', 'right', 'back'] as const)[f < 4 ? f : (f - 4) >> 1];
type Box = { x0: number; y0: number; x1: number; y1: number; n: number };
const box = (): Box => ({ x0: 99, y0: 99, x1: -1, y1: -1, n: 0 });
const add = (b: Box, x: number, y: number) => { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); b.n++; };

/** classify + recolour + overlay in place. `hairHex`/`skinHex` = palette entries (index 0 = keep drawn colour). */
export function applyLook(d: Uint8ClampedArray, W: number, H: number, cls: string, look: Look, hairHex: string[], skinHex: string[]) {
  const frames = Math.floor(W / FW), cfg = CFG[cls] ?? null, mage = cls === 'mage';
  const hc = look.hairColor ?? 0, sc = look.skinColor ?? 0, style = look.hairStyle ?? 0;
  const hr = rgb2hls(...hex(hairHex[hc] ?? hairHex[0])), sk = hex(skinHex[sc] ?? skinHex[0]);
  const at = (x: number, y: number) => (y * W + x) * 4;
  const hls = (i: number) => rgb2hls(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
  const isSkin = (i: number, fx: number, y: number) => { const [h, l, s] = hls(i), hd = h * 360; return y < 30 && fx >= 10 && fx <= 38 && hd >= 8 && hd <= 40 && s > 0.12 && s < 0.75 && l > 0.42; };
  const isGold = (i: number) => { const [h, , s] = hls(i), hd = h * 360; return hd >= 28 && hd <= 55 && s > 0.45; };
  const isPurple = (i: number) => { const [h, l] = hls(i), hd = h * 360; return hd >= 255 && hd <= 320 && l > 0.12; };
  let sumR = 0, sumG = 0, sumB = 0, cnt = 0; // drawn default hair colour (used for overlays when hairColor = 0)
  const geo: { face: Box; hair: Box }[] = [], geoHood: Box[] = [], hairSets: Set<number>[] = [];
  for (let f = 0; f < frames; f++) {
    const ox = f * FW, face = box(), hair = box(), hairPx: number[] = [], dir = dirOf(f);
    for (let y = 0; y < Math.min(H, 34); y++) for (let fx = 0; fx < FW; fx++) { const i = at(ox + fx, y); if (d[i + 3] >= 100 && isSkin(i, fx, y)) add(face, fx, y); }
    const purple = (fx: number, y: number) => { const i = at(ox + fx, y); return d[i + 3] >= 100 && isPurple(i) && !isGold(i); };
    if (cfg) for (let y = 0; y < Math.min(H, 34); y++) for (let fx = 0; fx < FW; fx++) {
      const i = at(ox + fx, y); if (d[i + 3] < 100 || isSkin(i, fx, y)) continue;
      const [h, , s] = hls(i), hd = h * 360;
      if (hd >= cfg[0] && hd <= cfg[1] && s >= cfg[2] && fx >= cfg[3] && fx <= cfg[4] && y <= cfg[5]) { add(hair, fx, y); hairPx.push(i); }
    }
    if (mage) { // hood case: hair = purple runs INSIDE the hood opening (not the outermost runs = hood), or below the hood seen from behind
      const y1 = dir === 'back' ? 27 : dir === 'front' ? 19 : 22;
      for (let y = 9; y <= y1; y++) {
        const runs: [number, number][] = []; let st = -1;
        for (let fx = 0; fx <= FW; fx++) { const on = fx < FW && purple(fx, y); if (on && st < 0) st = fx; if (!on && st >= 0) { runs.push([st, fx - 1]); st = -1; } }
        const take: [number, number][] = dir === 'back' ? (runs.length ? [[runs[0][0] + 2, runs[runs.length - 1][1] - 2]] : []) : runs.slice(1, -1);
        for (const [a, b] of take) for (let fx = a; fx <= b; fx++) if (purple(fx, y)) { add(hair, fx, y); hairPx.push(at(ox + fx, y)); }
      }
      const hood = box(); for (let y = 0; y < 16; y++) for (let fx = 0; fx < FW; fx++) if (purple(fx, y)) add(hood, fx, y);
      (geoHood[f] = hood);
    }
    hairSets[f] = new Set(hairPx);
    for (const i of hairPx) { sumR += d[i]; sumG += d[i + 1]; sumB += d[i + 2]; cnt++; }
    geo.push({ face, hair });
    // recolour
    for (let y = 0; y < Math.min(H, 34); y++) for (let fx = 0; fx < FW; fx++) {
      const i = at(ox + fx, y); if (d[i + 3] < 100) continue;
      if (sc && isSkin(i, fx, y)) { const l = hls(i)[1], k = l / 0.78; d[i] = Math.min(255, sk[0] * k * 255); d[i + 1] = Math.min(255, sk[1] * k * 255); d[i + 2] = Math.min(255, sk[2] * k * 255); }
    }
    if (hc) for (const i of hairPx) { const lt = hls(i)[1]; const [r, g, b] = hls2rgb(hr[0], Math.min(0.95, Math.max(0.05, hr[1] * (lt / 0.45))), Math.max(0.05, hr[2])); d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255; }
  }
  if (!style) return;
  const base: RGB = hc || !cnt ? hex(hairHex[hc] ?? hairHex[0]).map((v) => v * 255) as RGB : [sumR / cnt, sumG / cnt, sumB / cnt];
  const shade = (k: number): RGB => base.map((v) => Math.max(0, Math.min(255, v * k))) as RGB;
  const DARK = shade(0.55), MID = shade(1), LIGHT = shade(1.3);
  for (let f = 0; f < frames; f++) {
    const ox = f * FW, { face, hair } = geo[f], dir = dirOf(f), hood = geoHood[f];
    const anchor = mage ? hood : hair; if (!anchor || !anchor.n) continue;
    const put = (x: number, y: number, c: RGB) => { if (x < 0 || x >= FW || y < 0 || y >= H) return; const i = at(ox + x, y); d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; };
    const isHair = new Set<number>(); // frame-local hair pixels (post recolour) for column extension
    for (let y = 0; y < 34; y++) for (let x = 0; x < FW; x++) if (hairSets[f].has(at(ox + x, y))) isHair.add(y * FW + x);
    /** grow hair columns downward (long hair): each selected column continues from its lowest hair pixel, darkening, tapered at the shape edges */
    const grow = (cols: number[], len: number) => {
      const xs = cols.filter((x) => x >= 0 && x < FW); if (!xs.length) return; const lo = Math.min(...xs), hi = Math.max(...xs);
      for (const x of xs) {
        let yb = -1; for (let y = 33; y >= 0; y--) if (isHair.has(y * FW + x)) { yb = y; break; } if (yb < 0) continue;
        const edge = Math.min(x - lo, hi - x), n = Math.max(2, len - Math.max(0, 2 - edge) * 3);
        const src = at(ox + x, yb), c0: RGB = [d[src], d[src + 1], d[src + 2]];
        for (let k = 1; k <= n; k++) { const t = 1 - 0.35 * (k / n); put(x, yb + k, x === lo || x === hi || k === n ? DARK : c0.map((v) => v * t * (((x + k) % 4 === 0) ? 1.15 : 1)) as RGB); }
      }
    };
    const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
    /** ponytail: tapered lock hanging from (x, y), drifting `side` (+1 right / -1 left / 0 straight down) */
    const tail = (x: number, y: number, side: number, n = 15) => {
      for (let k = 0; k < n; k++) { const cx = x + side * Math.min(3, Math.round(k / 3)), w = k < n - 4 ? 2 : k < n - 2 ? 1 : 0;
        for (let dx = -w; dx <= w; dx++) put(cx + dx, y + k, k < 2 ? DARK : dx === -w || dx === w ? DARK : (k + dx) % 3 === 0 ? LIGHT : MID); }
    };
    const L = anchor.x0, R = anchor.x1, T = anchor.y0, B = hair.n ? hair.y1 : anchor.y1, cx = Math.round((L + R) / 2);
    if (style === 1) { // long
      if (mage) { if (dir === 'back') grow(range(hair.x0, hair.x1), 9); else if (hair.n) grow(range(hair.x0, hair.x1).filter((x) => x <= hair.x0 + 2 || x >= hair.x1 - 2), 10); }
      else if (dir === 'front') grow([...range(L, L + 2), ...range(R - 2, R)], 10);
      else if (dir === 'left') grow(range(R - 5, R), 11);
      else if (dir === 'right') grow(range(L, L + 5), 11);
      else grow(range(L, R), 12);
    } else if (style === 2) { // ponytail
      const y0 = mage ? 13 : T + 5;
      if (dir === 'back') tail(cx, mage ? 22 : B - 3, 0, 15);
      else if (dir === 'left') tail(R + 1, y0, 1);
      else if (dir === 'right') tail(L - 1, y0, -1);
      else if (!mage) for (let x = cx - 2; x <= cx + 2; x++) { put(x, T - 1, x === cx - 2 || x === cx + 2 ? DARK : LIGHT); put(x, T - 2, DARK); } // tie seen over the head
    } else if (style === 3) {
      if (mage) { // 前髪: 2-pixel fringe just under the hood opening (hair.y0 is the first inner-run row)
        if (dir !== 'back' && hair.n) { const y = hair.y0; for (const x of range(hair.x0 + 1, hair.x1 - 1)) { put(x, y, MID); if (x % 2) put(x, y + 1, DARK); } }
      } else { // ツンツン: 4 regularly spaced 3-pixel spikes along the top, not a stacked diamond
        const step = Math.max(4, Math.floor((R - L) / 4));
        for (let x = L + 2; x + 1 <= R; x += step) { put(x, T - 1, MID); put(x, T - 2, LIGHT); put(x - 1, T - 1, DARK); put(x + 1, T - 1, DARK); }
      }
    }
  }
}
