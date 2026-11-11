import { describe, it, expect } from 'vitest';
import { resolveTurn, BattleError, type BattleState, type Combatant } from '../src/index.js';
const mk = (o: Partial<Combatant> & { id: string; side: 'player' | 'enemy' }): Combatant => ({ name: o.id, level: 1, hp: 500, maxHp: 500, mp: 20, maxMp: 20, atk: 70, def: 10, matk: 20, mdef: 10, agi: 5, luk: 0, element: 'none', statuses: [], defending: false, guardTurns: 0, ...o });
const boss = () => mk({ id: 'e0', side: 'enemy', hp: 300, maxHp: 300, atk: 20, agi: 1, actions: [{ kind: 'attack', weight: 1 }],
  phases: [{ at: 0.6, name: 'p2', text: 'フェーズ2', atkMul: 2, actions: [{ kind: 'skill', weight: 1, name: '岩石落とし', mult: 1, aoe: true }] }, { at: 0.25, name: 'p3', text: 'フェーズ3', defMul: 0.5 }], phase: 0 });
const st = (cs: Combatant[]): BattleState => ({ turn: 1, status: 'active', canFlee: false, combatants: cs, log: [] });
const r0 = () => 0.5;
describe('PHASE 8 engine: boss phases / party', () => {
  it('enters phases once at HP thresholds, applies multipliers and new action table', () => {
    let s = st([mk({ id: 'p0', side: 'player', agi: 9 }), mk({ id: 'p1', side: 'player', agi: 8 }), boss()]);
    const all = () => ({ p0: { type: 'attack', target: 'e0' } as const, p1: { type: 'attack', target: 'e0' } as const });
    const r1 = resolveTurn(s, all(), r0); s = r1.state;
    const b = s.combatants.find((c) => c.id === 'e0')!;
    expect(b.hp / b.maxHp).toBeLessThanOrEqual(0.6); expect(b.phase).toBe(1); expect(b.atk).toBe(40);
    expect(r1.events.filter((e) => e.kind === 'phase').map((e) => e.text)).toEqual(['フェーズ2']);
    // phase-2 action is AoE: both players are hit in the same enemy action
    const hits = r1.events.filter((e) => e.actor === 'e0' && e.kind === 'damage').map((e) => e.target);
    expect(new Set(hits)).toEqual(new Set(['p0', 'p1']));
    const r2 = resolveTurn(s, all(), r0); const b2 = r2.state.combatants.find((c) => c.id === 'e0')!;
    if (b2.hp > 0) { expect(b2.phase).toBe(2); expect(b2.def).toBe(5); }
    expect([...r1.events, ...r2.events].filter((e) => e.kind === 'phase').length).toBeGreaterThanOrEqual(b2.hp > 0 ? 2 : 1);
  });
  it('a big hit can cross two thresholds at once (both phases fire in order)', () => {
    const s = st([mk({ id: 'p0', side: 'player', atk: 240 }), boss()]);
    const r = resolveTurn(s, { p0: { type: 'attack', target: 'e0' } }, r0);
    const b = r.state.combatants.find((c) => c.id === 'e0')!;
    expect(b.hp).toBeGreaterThan(0); expect(r.events.filter((e) => e.kind === 'phase').map((e) => e.value)).toEqual([2, 3]);
  });
  it('party: per-player inventory (invBy) validates each bag separately and reports consumedBy', () => {
    const s = st([mk({ id: 'p0', side: 'player', hp: 100 }), mk({ id: 'p1', side: 'player', hp: 100 }), mk({ id: 'e0', side: 'enemy', hp: 999, maxHp: 999, atk: 1 })]);
    const cmds = { p0: { type: 'item', itemId: 'potion_small' } as const, p1: { type: 'item', itemId: 'potion_small' } as const };
    expect(() => resolveTurn(s, cmds, r0, {}, { p0: { potion_small: 1 }, p1: {} })).toThrow(BattleError);
    const r = resolveTurn(s, cmds, r0, {}, { p0: { potion_small: 1 }, p1: { potion_small: 1 } });
    expect(r.consumedBy).toEqual(expect.arrayContaining([{ actor: 'p0', itemId: 'potion_small' }, { actor: 'p1', itemId: 'potion_small' }]));
    expect(() => resolveTurn(s, { p0: { type: 'defend' } }, r0)).toThrow('missing_command');
  });
});
