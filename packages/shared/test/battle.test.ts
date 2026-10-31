import { describe, it, expect } from 'vitest';
import { physicalDamage, magicDamage, fleeChance, critRate, resolveTurn, turnOrder, computeRewards, BattleError, STATUS_IDS, type BattleState, type Combatant } from '../src/index.js';
const fixed = (v: number) => () => v;
const seq = (...vs: number[]) => { let i = 0; return () => vs[i++ % vs.length]; };
const mk = (o: Partial<Combatant> & { id: string; side: 'player' | 'enemy' }): Combatant => ({ name: o.id, level: 1, hp: 50, maxHp: 50, mp: 20, maxMp: 20, atk: 20, def: 10, matk: 20, mdef: 10, agi: 5, luk: 0, element: 'none', statuses: [], defending: false, guardTurns: 0, skills: ['mage_fire', 'warrior_power_strike', 'priest_heal', 'knight_cover'], ...o });
const st = (cs: Combatant[]): BattleState => ({ turn: 1, status: 'active', combatants: cs, log: [], canFlee: true });
describe('SECTION 08 formulas', () => {
  it('physical: MAX(1, ATK×mult − DEF×0.5) with 0.95–1.05 random', () => {
    expect(physicalDamage(20, 10, 1, fixed(0.5))).toBe(15);
    expect(physicalDamage(20, 10, 1, fixed(0))).toBe(Math.floor(15 * 0.95));
    expect(physicalDamage(20, 10, 1, fixed(0.9999999))).toBe(Math.floor(15 * 1.05));
    expect(physicalDamage(1, 100, 1, fixed(0))).toBe(1);
    expect(physicalDamage(20, 10, 1, fixed(0.5), true)).toBe(22); // crit ×1.5
  });
  it('magic: MAX(1, MATK×mult − MDEF×0.4)', () => { expect(magicDamage(20, 10, 1.5, fixed(0.5))).toBe(26); expect(magicDamage(1, 99, 1, fixed(0.5))).toBe(1); });
  it('crit rate from LUK, capped', () => { expect(critRate(0)).toBeCloseTo(0.02); expect(critRate(10)).toBeGreaterThan(critRate(5)); expect(critRate(999)).toBe(0.25); });
  it('flee chance varies with level diff and AGI, clamped', () => {
    expect(fleeChance(5, 1, 10, 5)).toBeGreaterThan(fleeChance(1, 5, 5, 10));
    expect(fleeChance(99, 1, 99, 1)).toBe(0.95); expect(fleeChance(1, 99, 1, 99)).toBe(0.1);
  });
  it('turn order by AGI', () => { expect(turnOrder([mk({ id: 'a', side: 'player', agi: 3 }), mk({ id: 'b', side: 'enemy', agi: 9 })]).map((c) => c.id)).toEqual(['b', 'a']); });
});
describe('resolveTurn', () => {
  it('attack damages target; defend halves incoming damage', () => {
    const s = st([mk({ id: 'p', side: 'player', agi: 9 }), mk({ id: 'e', side: 'enemy' })]);
    const r1 = resolveTurn(s, { p: { type: 'attack', target: 'e' } }, fixed(0.5));
    expect(r1.state.combatants[1].hp).toBe(35); expect(r1.state.turn).toBe(2); expect(s.combatants[1].hp).toBe(50); // immutable input
    const plain = 50 - r1.state.combatants[0].hp;
    const r2 = resolveTurn(s, { p: { type: 'defend' } }, fixed(0.5));
    expect(50 - r2.state.combatants[0].hp).toBe(Math.floor(plain * 0.5));
  });
  it('victory when all enemies KO; log records every action', () => {
    const s = st([mk({ id: 'p', side: 'player', atk: 200, agi: 9 }), mk({ id: 'e', side: 'enemy', reward: { exp: 10, gold: 5, drops: [{ itemId: 'x', rate: 1, min: 1, max: 1 }] } })]);
    const r = resolveTurn(s, { p: { type: 'attack', target: 'e' } }, fixed(0.5));
    expect(r.state.status).toBe('victory'); expect(r.state.log.map((e) => e.kind)).toEqual(['damage', 'ko', 'end']);
    expect(computeRewards(r.state, 1, fixed(0.5))).toEqual({ exp: 10, gold: 5, drops: [{ itemId: 'x', qty: 1 }] });
  });
  it('defeat when party KO', () => {
    const r = resolveTurn(st([mk({ id: 'p', side: 'player', hp: 1 }), mk({ id: 'e', side: 'enemy', agi: 9 })]), { p: { type: 'defend' } }, fixed(0.5));
    expect(r.state.status).toBe('defeat');
  });
  it('flee success / failure', () => {
    const s = st([mk({ id: 'p', side: 'player', agi: 9 }), mk({ id: 'e', side: 'enemy' })]);
    expect(resolveTurn(s, { p: { type: 'flee' } }, fixed(0.01)).state.status).toBe('fled');
    const f = resolveTurn(s, { p: { type: 'flee' } }, fixed(0.99)); expect(f.state.status).toBe('active'); expect(f.events.some((e) => e.kind === 'flee_fail')).toBe(true);
    expect(() => resolveTurn({ ...s, canFlee: false }, { p: { type: 'flee' } }, fixed(0.01))).toThrow(BattleError);
  });
  it('skill consumes MP, fire hits weakness ×1.5, silence blocks skills, MP check', () => {
    const s = st([mk({ id: 'p', side: 'player', agi: 9 }), mk({ id: 'e', side: 'enemy', weakTo: ['fire'], hp: 500, maxHp: 500 })]);
    const r = resolveTurn(s, { p: { type: 'skill', skillId: 'mage_fire', target: 'e' } }, fixed(0.5));
    expect(r.state.combatants[0].mp).toBe(15); expect(500 - r.state.combatants[1].hp).toBe(Math.floor(26 * 1.5));
    s.combatants[0].statuses = [{ id: 'silence', turns: 2 }];
    expect(() => resolveTurn(s, { p: { type: 'skill', skillId: 'mage_fire', target: 'e' } }, fixed(0.5))).toThrow('silenced');
    s.combatants[0].statuses = []; s.combatants[0].mp = 0;
    expect(() => resolveTurn(s, { p: { type: 'skill', skillId: 'mage_fire', target: 'e' } }, fixed(0.5))).toThrow('not_enough_mp');
    expect(() => resolveTurn(s, { p: { type: 'skill', skillId: 'nope', target: 'e' } }, fixed(0.5))).toThrow('unknown_skill');
  });
  it('item requires inventory and is reported as consumed', () => {
    const s = st([mk({ id: 'p', side: 'player', hp: 10, agi: 9 }), mk({ id: 'e', side: 'enemy', atk: 1 })]);
    expect(() => resolveTurn(s, { p: { type: 'item', itemId: 'potion_small' } }, fixed(0.5), {})).toThrow('no_item');
    const r = resolveTurn(s, { p: { type: 'item', itemId: 'potion_small' } }, fixed(0.5), { potion_small: 1 });
    expect(r.consumed).toEqual(['potion_small']); expect(r.state.combatants[0].hp).toBeGreaterThan(30);
  });
  it('invalid target / missing command rejected', () => {
    const s = st([mk({ id: 'p', side: 'player' }), mk({ id: 'e', side: 'enemy' })]);
    expect(() => resolveTurn(s, { p: { type: 'attack', target: 'p' } }, fixed(0.5))).toThrow('invalid_target');
    expect(() => resolveTurn(s, {}, fixed(0.5))).toThrow('missing_command');
  });
});
describe('status effects (7 kinds)', () => {
  const base = (status: any, pOver: Partial<Combatant> = {}) => st([mk({ id: 'p', side: 'player', agi: 9, statuses: [{ id: status, turns: 2 }], ...pOver }), mk({ id: 'e', side: 'enemy', atk: 1, hp: 500, maxHp: 500 })]);
  it('all 7 defined', () => expect(STATUS_IDS.sort()).toEqual(['atk_down', 'confusion', 'def_down', 'paralysis', 'poison', 'silence', 'sleep']));
  it('poison ticks 8% max HP at end of turn and expires', () => {
    const r = resolveTurn(base('poison', { maxHp: 100, hp: 100 }), { p: { type: 'defend' } }, fixed(0.5));
    expect(r.events.find((e) => e.kind === 'poison')!.value).toBe(8);
    const r2 = resolveTurn(r.state, { p: { type: 'defend' } }, fixed(0.5)); expect(r2.state.combatants[0].statuses).toEqual([]);
  });
  it('sleep skips action; paralysis skips at 50%', () => {
    expect(resolveTurn(base('sleep'), { p: { type: 'attack', target: 'e' } }, fixed(0.99)).state.combatants[1].hp).toBe(500);
    expect(resolveTurn(base('paralysis'), { p: { type: 'attack', target: 'e' } }, fixed(0.1)).state.combatants[1].hp).toBe(500);
    expect(resolveTurn(base('paralysis'), { p: { type: 'attack', target: 'e' } }, fixed(0.9)).state.combatants[1].hp).toBeLessThan(500);
  });
  it('sleep is cured by taking damage', () => {
    const s = st([mk({ id: 'p', side: 'player', statuses: [{ id: 'sleep', turns: 3 }] }), mk({ id: 'e', side: 'enemy', agi: 9 })]);
    const r = resolveTurn(s, { p: { type: 'defend' } }, fixed(0.99)); expect(r.state.combatants[0].statuses.find((x) => x.id === 'sleep')).toBeUndefined();
  });
  it('atk_down / def_down change damage by ×0.7', () => {
    const n = 500 - resolveTurn(base('none' as any), { p: { type: 'attack', target: 'e' } }, fixed(0.5)).state.combatants[1].hp;
    const d = 500 - resolveTurn(base('atk_down'), { p: { type: 'attack', target: 'e' } }, fixed(0.5)).state.combatants[1].hp;
    expect(d).toBeLessThan(n);
  });
  it('confusion can make the actor hit someone at random', () => {
    const r = resolveTurn(base('confusion'), { p: { type: 'attack', target: 'e' } }, seq(0.1, 0.0, 0.5, 0.5, 0.5));
    expect(r.events.some((e) => e.kind === 'confused')).toBe(true);
  });
  it('enemy action can inflict a status at its rate', () => {
    const s = st([mk({ id: 'p', side: 'player' }), mk({ id: 'e', side: 'enemy', agi: 9, actions: [{ kind: 'skill', weight: 1, name: '毒の胞子', inflict: { status: 'poison', rate: 0.6 } }] })]);
    expect(resolveTurn(s, { p: { type: 'defend' } }, fixed(0.5)).state.combatants[0].statuses.map((x) => x.id)).toEqual(['poison']);
    expect(resolveTurn(s, { p: { type: 'defend' } }, fixed(0.7)).state.combatants[0].statuses).toEqual([]);
  });
});
