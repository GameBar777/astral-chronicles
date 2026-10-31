import { describe, it, expect } from 'vitest';
import { applyExp, expToNext, expTable, expFromMonster, MAX_LEVEL, statsAt, CLASSES, CLASS_IDS, validateCharacterName, validateAppearance } from '../src/index.js';
describe('exp table', () => {
  it('formula and monotonic', () => {
    expect(expToNext(1)).toBe(100); expect(expToNext(100)).toBeNull();
    const t = expTable(); expect(t).toHaveLength(100);
    for (let i = 1; i < 99; i++) expect(t[i].toNext!).toBeGreaterThan(t[i - 1].toNext!);
  });
  it('level up incl. multi-level and cap', () => {
    expect(applyExp(1, 0, 99)).toMatchObject({ level: 1, exp: 99, levelsGained: 0 });
    expect(applyExp(1, 50, 50)).toMatchObject({ level: 2, exp: 0, levelsGained: 1 });
    const two = expToNext(1)! + expToNext(2)!; expect(applyExp(1, 0, two + 5)).toMatchObject({ level: 3, exp: 5 });
    expect(applyExp(99, 0, expToNext(99)! + 777)).toEqual({ level: MAX_LEVEL, exp: 0, levelsGained: 1, discarded: 777 });
    expect(applyExp(100, 0, 10)).toMatchObject({ level: 100, exp: 0, discarded: 10 });
    expect(() => applyExp(1, 0, -5)).toThrow(); expect(() => applyExp(1, 0, 1.5)).toThrow();
  });
  it('monster exp level diff', () => {
    expect(expFromMonster(100, 5, 5)).toBe(100); expect(expFromMonster(100, 10, 5)).toBe(150);
    expect(expFromMonster(100, 1, 30)).toBe(10); expect(expFromMonster(1, 1, 30)).toBe(1);
  });
});
describe('classes', () => {
  it('4 classes with roles reflected in stats', () => {
    expect(CLASS_IDS).toEqual(['warrior', 'knight', 'mage', 'priest']);
    const s = Object.fromEntries(CLASS_IDS.map((c) => [c, statsAt(c, 50)]));
    expect(s.warrior.atk).toBeGreaterThan(s.knight.atk); expect(s.warrior.maxHp).toBeGreaterThan(s.mage.maxHp);
    expect(s.knight.def).toBeGreaterThan(s.warrior.def); expect(s.mage.matk).toBeGreaterThan(s.priest.matk);
    expect(s.priest.matk).toBeGreaterThan(s.warrior.matk);
    for (const c of CLASS_IDS) { expect(CLASSES[c].equippable.length).toBeGreaterThan(0); expect(statsAt(c, 2).maxHp).toBeGreaterThan(statsAt(c, 1).maxHp); }
    expect(CLASSES.mage.equippable).not.toContain('two_hand_sword');
  });
});
describe('name validation', () => {
  it.each([['アルド', true], ['勇者タロウ', true], ['Hero01', true], ['ＨＥＲＯ', true], ['あ', false], ['あいうえおかきくけこさしす', false],
    ['hero!', false], ['he ro', false], ['12345', false], ['GameMaster', false], ['運営さん', false], ['<script>', false], ['', false], ['😀😀', false]])('%s -> %s', (n, ok) => {
    expect(validateCharacterName(n).ok).toBe(ok);
  });
  it('normalizes fullwidth', () => { const r = validateCharacterName(' ＨＥＲＯ '); expect(r.ok && r.name).toBe('HERO'); });
  it('rejects non-string', () => expect(validateCharacterName(123 as any).ok).toBe(false));
  it('appearance', () => {
    expect(validateAppearance({ bodyType: 'a', hairStyle: 0, hairColor: 5, skinColor: 3 })).toBe(true);
    expect(validateAppearance({ bodyType: 'c', hairStyle: 0, hairColor: 0, skinColor: 0 })).toBe(false);
    expect(validateAppearance({ bodyType: 'a', hairStyle: 9, hairColor: 0, skinColor: 0 })).toBe(false);
    expect(validateAppearance({ bodyType: 'a', hairStyle: 0, hairColor: 0, skinColor: 0, x: 1 })).toBe(false);
  });
});
