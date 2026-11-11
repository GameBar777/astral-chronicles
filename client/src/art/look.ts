/**
 * BUG-008: reflect the character-creation appearance on the generated class sheets at runtime.
 * Recolours hair (per-class hue window inside the head box) and skin (face area) of every 48×60 frame, and widens body
 * type "b" slightly. Hair *style* cannot change on a pre-drawn sheet (documented limitation); the mage's hair is under
 * the hood so only skin applies. Result textures are cached per (class, look).
 */
import Phaser from 'phaser';
import { HAIR, SKIN } from './placeholderArt';
export type Look = { bodyType?: string; hairStyle?: number; hairColor?: number; skinColor?: number };
const CFG: Record<string, [number, number, number, number, number, number] | null> = {
  warrior: [0, 40, 0.35, 10, 38, 24], knight: [25, 60, 0.3, 10, 38, 22], priest: [25, 60, 0.3, 12, 38, 24], mage: null };
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
function rgb2hls(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; if (mx === mn) return [0, l, 0];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [h / 6, l, s];
}
function hls2rgb(h: number, l: number, s: number) {
  if (s === 0) return [l, l, l]; const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
export const lookId = (cls: string, look?: Look | string | null) => {
  const l: Look = typeof look === 'string' ? (() => { try { return JSON.parse(look || '{}'); } catch { return {}; } })() : look ?? {};
  return { l, key: `ch_${cls}_h${l.hairColor ?? 0}s${l.skinColor ?? 0}b${l.bodyType ?? 'a'}` };
};
/** returns a spritesheet texture key for this class + appearance (falls back to the base sheet) */
export function lookTexture(scene: Phaser.Scene, cls: string, look?: Look | string | null) {
  const base = `ch_${cls}`; if (!scene.textures.exists(base)) return base;
  const { l, key } = lookId(cls, look);
  if (!l.hairColor && !l.skinColor && (l.bodyType ?? 'a') === 'a') return base; // defaults = original art
  if (scene.textures.exists(key)) return key;
  const src = scene.textures.get(base).getSourceImage() as HTMLImageElement, W = src.width, H = src.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d')!; ctx.drawImage(src, 0, 0);
  const id = ctx.getImageData(0, 0, W, H), d = id.data, cfg = CFG[cls] ?? null;
  const hr = rgb2hls(...(hex(HAIR[l.hairColor ?? 0] ?? HAIR[0]) as [number, number, number])), sk = hex(SKIN[l.skinColor ?? 0] ?? SKIN[0]);
  const doHair = !!cfg && (l.hairColor ?? 0) !== 0, doSkin = (l.skinColor ?? 0) !== 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; if (d[i + 3] < 100) continue;
    const fx = x % 48, [h, lt, s] = rgb2hls(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255), hd = h * 360;
    if (y < 30 && fx >= 10 && fx <= 38 && hd >= 8 && hd <= 40 && s > 0.12 && s < 0.75 && lt > 0.42) {
      if (doSkin) { const k = lt / 0.78; d[i] = Math.min(255, sk[0] * k * 255); d[i + 1] = Math.min(255, sk[1] * k * 255); d[i + 2] = Math.min(255, sk[2] * k * 255); }
      continue;
    }
    if (doHair && cfg && hd >= cfg[0] && hd <= cfg[1] && s >= cfg[2] && fx >= cfg[3] && fx <= cfg[4] && y <= cfg[5]) {
      const [r, g, b] = hls2rgb(hr[0], Math.min(0.95, Math.max(0.05, hr[1] * (lt / 0.45))), Math.max(0.05, hr[2]));
      d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255;
    }
  }
  ctx.putImageData(id, 0, 0);
  let out: HTMLCanvasElement = cv;
  if (l.bodyType === 'b') { // sturdier build: each frame widened ~8% around its centre
    const o = document.createElement('canvas'); o.width = W; o.height = H; const oc = o.getContext('2d')!; oc.imageSmoothingEnabled = false;
    for (let f = 0; f < W / 48; f++) oc.drawImage(cv, f * 48, 0, 48, H, f * 48 - 2, 0, 52, H);
    out = o;
  }
  scene.textures.addSpriteSheet(key, out as unknown as HTMLImageElement, { frameWidth: 48, frameHeight: 60 });
  return key;
}
