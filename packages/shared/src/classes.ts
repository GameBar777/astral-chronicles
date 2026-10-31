import type { ClassId } from './types.js';
export type Primary = 'str' | 'vit' | 'int' | 'agi' | 'luk';
export interface ClassDef {
  id: ClassId; name: string; role: string;
  base: Record<Primary, number> & { hp: number; mp: number };
  growth: Record<Primary, number> & { hp: number; mp: number }; // per level
  equippable: string[]; startingSkills: string[];
}
/** Master data v1 (balance values are initial proposals; tune in later phases). */
export const CLASSES: Record<ClassId, ClassDef> = {
  warrior: { id: 'warrior', name: '戦士', role: '前衛アタッカー：高HP・高物理攻撃',
    base: { hp: 60, mp: 10, str: 12, vit: 9, int: 3, agi: 7, luk: 5 },
    growth: { hp: 14, mp: 2, str: 2.4, vit: 1.6, int: 0.4, agi: 1.2, luk: 0.8 },
    equippable: ['one_hand_sword', 'two_hand_sword', 'spear', 'dagger', 'shield', 'head', 'body', 'arms', 'legs', 'accessory'],
    startingSkills: ['warrior_power_strike'] },
  knight: { id: 'knight', name: '騎士', role: 'タンク：高防御・味方を守る',
    base: { hp: 55, mp: 15, str: 9, vit: 12, int: 4, agi: 5, luk: 5 },
    growth: { hp: 13, mp: 3, str: 1.7, vit: 2.4, int: 0.6, agi: 0.9, luk: 0.8 },
    equippable: ['one_hand_sword', 'spear', 'shield', 'head', 'body', 'arms', 'legs', 'accessory'],
    startingSkills: ['knight_cover'] },
  mage: { id: 'mage', name: '魔法使い', role: '後衛火力：属性魔法による範囲攻撃',
    base: { hp: 35, mp: 40, str: 3, vit: 5, int: 13, agi: 7, luk: 6 },
    growth: { hp: 7, mp: 9, str: 0.4, vit: 0.8, int: 2.7, agi: 1.2, luk: 1.0 },
    equippable: ['staff', 'dagger', 'head', 'body', 'arms', 'legs', 'accessory'],
    startingSkills: ['mage_fire'] },
  priest: { id: 'priest', name: '僧侶', role: '回復・支援：パーティーの生存率を高める',
    base: { hp: 40, mp: 35, str: 5, vit: 7, int: 11, agi: 6, luk: 7 },
    growth: { hp: 9, mp: 8, str: 0.7, vit: 1.2, int: 2.2, agi: 1.0, luk: 1.2 },
    equippable: ['staff', 'shield', 'head', 'body', 'arms', 'legs', 'accessory'],
    startingSkills: ['priest_heal'] },
};
export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];
export interface Stats { maxHp: number; maxMp: number; str: number; vit: number; int: number; agi: number; luk: number; atk: number; def: number; matk: number; mdef: number; }
/** Stats without equipment at a level. ATK/DEF/MATK/MDEF are derived from primaries. */
export function statsAt(cls: ClassId, level: number): Stats {
  const c = CLASSES[cls]; const n = level - 1;
  const p = (k: Primary) => Math.floor(c.base[k] + c.growth[k] * n);
  const str = p('str'), vit = p('vit'), int = p('int'), agi = p('agi'), luk = p('luk');
  return { maxHp: Math.floor(c.base.hp + c.growth.hp * n + vit * 2), maxMp: Math.floor(c.base.mp + c.growth.mp * n + int),
    str, vit, int, agi, luk, atk: str * 2, def: Math.floor(vit * 1.5), matk: int * 2, mdef: Math.floor(int * 0.6 + vit * 0.6) };
}
