/** SECTION 10-12: equipment slots, enhancement, gathering/crafting rules (pure; the SERVER applies them). */
import type { ClassId } from './types.js';
import { CLASSES } from './classes.js';
export type EquipCategory = 'one_hand_sword' | 'two_hand_sword' | 'spear' | 'staff' | 'dagger' | 'shield' | 'head' | 'body' | 'arms' | 'legs' | 'accessory';
export type EquipSlot = 'weapon' | 'shield' | 'head' | 'body' | 'arms' | 'legs' | 'accessory1' | 'accessory2';
export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'shield', 'head', 'body', 'arms', 'legs', 'accessory1', 'accessory2'];
export const WEAPON_CATEGORIES: EquipCategory[] = ['one_hand_sword', 'two_hand_sword', 'spear', 'staff', 'dagger'];
export const CATEGORY_NAMES: Record<EquipCategory, string> = { one_hand_sword: '片手剣', two_hand_sword: '両手剣', spear: '槍', staff: '杖', dagger: '短剣', shield: '盾', head: '頭防具', body: '胴防具', arms: '腕防具', legs: '足防具', accessory: 'アクセサリー' };
export const SLOT_NAMES: Record<EquipSlot, string> = { weapon: '武器', shield: '盾', head: '頭', body: '胴', arms: '腕', legs: '足', accessory1: 'アクセ1', accessory2: 'アクセ2' };
/** candidate slots for a category (accessory may go into either accessory slot) */
export function slotsFor(cat: EquipCategory): EquipSlot[] {
  if (WEAPON_CATEGORIES.includes(cat)) return ['weapon'];
  if (cat === 'accessory') return ['accessory1', 'accessory2'];
  return [cat as EquipSlot];
}
export interface EquipDef { slot_category: EquipCategory; level_req: number; class_restrict: string[]; atk: number; def: number; matk: number; mdef: number }
export class ItemError extends Error { constructor(public code: string) { super(code); } }
/** throws ItemError: level_too_low / class_cannot_equip */
export function checkEquip(cls: ClassId, level: number, d: EquipDef) {
  if (level < d.level_req) throw new ItemError('level_too_low');
  if (!CLASSES[cls].equippable.includes(d.slot_category)) throw new ItemError('class_cannot_equip');
  if (d.class_restrict.length && !d.class_restrict.includes(cls)) throw new ItemError('class_cannot_equip');
}
// ---- SECTION 11 enhancement ----
export const ENHANCE_MAX = 10;
/** success rate to go from (level) to (level+1) */
export const ENHANCE_RATES = [1, 1, 1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.35, 0.2];
export const enhanceRate = (from: number) => { if (from < 0 || from >= ENHANCE_MAX) throw new ItemError('max_enhance'); return ENHANCE_RATES[from]; };
/** gold + material cost for (from -> from+1). Material tier rises with level. */
export function enhanceCost(from: number) {
  const gold = 30 * (from + 1) * (from + 1);
  const materials = from < 3 ? [{ itemId: 'copper_ore', qty: 1 + from }] : from < 7 ? [{ itemId: 'iron_ore', qty: from - 1 }] : [{ itemId: 'iron_ore', qty: 4 }, { itemId: 'magic_stone', qty: from - 6 }];
  return { gold, materials };
}
/** per +1: weapons grow ATK/MATK, armor/shields/accessories grow DEF/MDEF, by max(1, round(base*8%)) each. */
export function enhancedStats(d: EquipDef, level: number) {
  const g = (v: number) => (v > 0 ? v + level * Math.max(1, Math.round(v * 0.08)) : v);
  const w = WEAPON_CATEGORIES.includes(d.slot_category);
  return { atk: w ? g(d.atk) : d.atk, def: w ? d.def : g(d.def), matk: w ? g(d.matk) : d.matk, mdef: w ? d.mdef : g(d.mdef) };
}
export function sumEquip(items: { def: EquipDef; enhance: number }[]) {
  const t = { atk: 0, def: 0, matk: 0, mdef: 0 };
  for (const i of items) { const s = enhancedStats(i.def, i.enhance); t.atk += s.atk; t.def += s.def; t.matk += s.matk; t.mdef += s.mdef; }
  return t;
}
// ---- SECTION 12 gathering ----
export type GatherType = 'mining' | 'logging' | 'herb' | 'monster';
export const GATHER_NAMES: Record<GatherType, string> = { mining: '採掘', logging: '伐採', herb: '薬草採集', monster: 'モンスター素材収集' };
export interface LootEntry { itemId: string; weight: number; minLevel: number; min: number; max: number }
/** gathering exp to reach next level */
export const gatherExpToNext = (lv: number) => 10 * lv * lv;
export const GATHER_MAX_LEVEL = 50;
export const GATHER_RANGE = 56; // px between feet and node
export function rollLoot(table: LootEntry[], level: number, rng: () => number) {
  const ok = table.filter((e) => level >= e.minLevel);
  if (!ok.length) throw new ItemError('gather_level_too_low');
  const tot = ok.reduce((t, e) => t + e.weight, 0); let r = rng() * tot;
  const e = ok.find((x) => (r -= x.weight) < 0) ?? ok[0];
  return { itemId: e.itemId, qty: e.min + Math.floor(rng() * (e.max - e.min + 1)) };
}
export function addGatherExp(level: number, exp: number, gain: number) {
  let lv = level, x = exp + gain;
  while (lv < GATHER_MAX_LEVEL && x >= gatherExpToNext(lv)) { x -= gatherExpToNext(lv); lv++; }
  if (lv >= GATHER_MAX_LEVEL) x = 0;
  return { level: lv, exp: x };
}
export const INVENTORY_SLOTS = 60;
