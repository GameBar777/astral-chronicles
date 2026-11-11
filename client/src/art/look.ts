/**
 * BUG-008 (closed): reflect character-creation appearance on the class sheets at runtime.
 * Hair colour, skin, body type, and hair style (標準/ロング/ポニーテール/ツンツン; mage: 前髪 under the hood).
 * Mage hood fabric is not recoloured — only the locks in the opening (and hair seen from behind) change.
 * Result textures are cached per (class, look).
 */
import Phaser from 'phaser';
import { HAIR, SKIN } from './placeholderArt';
import { applyLook, type Look, HAIR_STYLE_NAMES } from './lookcore';
export type { Look };
export { HAIR_STYLE_NAMES };
export const lookId = (cls: string, look?: Look | string | null) => {
  const l: Look = typeof look === 'string' ? (() => { try { return JSON.parse(look || '{}'); } catch { return {}; } })() : look ?? {};
  return { l, key: `ch_${cls}_h${l.hairColor ?? 0}s${l.skinColor ?? 0}b${l.bodyType ?? 'a'}y${l.hairStyle ?? 0}` };
};
/** returns a spritesheet texture key for this class + appearance (falls back to the base sheet) */
export function lookTexture(scene: Phaser.Scene, cls: string, look?: Look | string | null) {
  const base = `ch_${cls}`; if (!scene.textures.exists(base)) return base;
  const { l, key } = lookId(cls, look);
  if (!l.hairColor && !l.skinColor && (l.bodyType ?? 'a') === 'a' && !l.hairStyle) return base;
  if (scene.textures.exists(key)) return key;
  const src = scene.textures.get(base).getSourceImage() as HTMLImageElement, W = src.width, H = src.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d')!; ctx.drawImage(src, 0, 0);
  const id = ctx.getImageData(0, 0, W, H);
  applyLook(id.data, W, H, cls, l, HAIR, SKIN);
  ctx.putImageData(id, 0, 0);
  let out: HTMLCanvasElement = cv;
  if (l.bodyType === 'b') {
    const o = document.createElement('canvas'); o.width = W; o.height = H; const oc = o.getContext('2d')!; oc.imageSmoothingEnabled = false;
    for (let f = 0; f < W / 48; f++) oc.drawImage(cv, f * 48, 0, 48, H, f * 48 - 2, 0, 52, H);
    out = o;
  }
  scene.textures.addSpriteSheet(key, out as unknown as HTMLImageElement, { frameWidth: 48, frameHeight: 60 });
  return key;
}
