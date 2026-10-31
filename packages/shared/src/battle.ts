/**
 * SECTION 08 turn-based command battle engine (pure, deterministic given `rng`).
 * The SERVER runs this; the client only renders the returned state/events.
 */
import { expFromMonster } from './leveling.js';
export type Rng = () => number;
export type StatusId = 'poison' | 'paralysis' | 'sleep' | 'confusion' | 'atk_down' | 'def_down' | 'silence';
/** turns = duration, cure = how it ends (all also expire by turns). */
export const STATUS_DEFS: Record<StatusId, { name: string; turns: number; cure: string }> = {
  poison: { name: '毒', turns: 4, cure: 'ターン経過・どくけし草（毎ターン終了時 最大HPの8%ダメージ）' },
  paralysis: { name: '麻痺', turns: 2, cure: 'ターン経過（50%で行動不能）' },
  sleep: { name: '睡眠', turns: 3, cure: 'ターン経過・ダメージを受ける（行動不能）' },
  confusion: { name: '混乱', turns: 2, cure: 'ターン経過・ダメージを受けると50%で解除（50%で敵味方ランダムに攻撃）' },
  atk_down: { name: '攻撃力低下', turns: 3, cure: 'ターン経過（ATK/MATK×0.7）' },
  def_down: { name: '防御力低下', turns: 3, cure: 'ターン経過（DEF/MDEF×0.7）' },
  silence: { name: '沈黙', turns: 3, cure: 'ターン経過（スキル使用不可）' },
};
export const STATUS_IDS = Object.keys(STATUS_DEFS) as StatusId[];
export interface EnemyAction { kind: 'attack' | 'skill'; weight: number; name?: string; mult?: number; magic?: boolean; inflict?: { status: StatusId; rate: number } }
export interface Combatant {
  id: string; side: 'player' | 'enemy'; name: string; level: number; monsterId?: string; characterId?: string;
  hp: number; maxHp: number; mp: number; maxMp: number; atk: number; def: number; matk: number; mdef: number; agi: number; luk: number;
  element: string; weakTo?: string[]; statuses: { id: StatusId; turns: number }[]; defending: boolean; guardTurns: number;
  actions?: EnemyAction[]; skills?: string[]; reward?: { exp: number; gold: number; drops: { itemId: string; rate: number; min: number; max: number }[] };
}
export type Command =
  | { type: 'attack'; target: string } | { type: 'skill'; skillId: string; target?: string }
  | { type: 'item'; itemId: string; target?: string } | { type: 'defend' } | { type: 'flee' };
export interface BattleEvent { turn: number; actor?: string; target?: string; kind: string; value?: number; crit?: boolean; status?: StatusId; text: string }
export interface BattleState { turn: number; status: 'active' | 'victory' | 'defeat' | 'fled'; combatants: Combatant[]; log: BattleEvent[]; canFlee: boolean }
export interface SkillDef { name: string; type: 'physical' | 'magic' | 'heal' | 'guard'; mp: number; power: number; element?: string; target: 'enemy' | 'ally' | 'self' }
/** Mirrors `skills` master rows (002 migration). knight_cover (party cover) acts as a 2-turn guard while solo (TD-011). */
export const SKILLS: Record<string, SkillDef> = {
  warrior_power_strike: { name: 'パワースラッシュ', type: 'physical', mp: 4, power: 1.6, target: 'enemy' },
  knight_cover: { name: 'かばう', type: 'guard', mp: 3, power: 0, target: 'self' },
  mage_fire: { name: 'ファイア', type: 'magic', mp: 5, power: 1.5, element: 'fire', target: 'enemy' },
  priest_heal: { name: 'ヒール', type: 'heal', mp: 5, power: 1.2, target: 'ally' },
};
export const BATTLE_ITEMS: Record<string, { name: string; heal?: number; cure?: StatusId[] }> = {
  potion_small: { name: 'やくそう', heal: 30 },
  antidote: { name: 'どくけし草', cure: ['poison'] },
};
export class BattleError extends Error { constructor(public code: string) { super(code); } }

export const RAND_MIN = 0.95, RAND_MAX = 1.05, CRIT_MULT = 1.5, DEFEND_RATE = 0.5;
export const critRate = (luk: number) => Math.min(0.25, 0.02 + luk * 0.004);
const rand = (rng: Rng) => RAND_MIN + rng() * (RAND_MAX - RAND_MIN);
/** SECTION 08: MAX(1, ATK×倍率 − DEF×0.5) × 乱数(0.95-1.05) × クリティカル1.5 */
export function physicalDamage(atk: number, def: number, mult: number, rng: Rng, crit = false) {
  return Math.max(1, Math.floor(Math.max(1, atk * mult - def * 0.5) * rand(rng) * (crit ? CRIT_MULT : 1)));
}
/** SECTION 08: MAX(1, MATK×倍率 − MDEF×0.4) × 乱数 */
export function magicDamage(matk: number, mdef: number, mult: number, rng: Rng, crit = false) {
  return Math.max(1, Math.floor(Math.max(1, matk * mult - mdef * 0.4) * rand(rng) * (crit ? CRIT_MULT : 1)));
}
/** Flee chance: level difference and AGI (party avg vs enemy max). Clamped 10–95%. */
export function fleeChance(partyLv: number, enemyLv: number, partyAgi: number, enemyAgi: number) {
  return Math.min(0.95, Math.max(0.1, 0.6 + 0.05 * (partyLv - enemyLv) + 0.01 * (partyAgi - enemyAgi)));
}
const has = (c: Combatant, s: StatusId) => c.statuses.some((x) => x.id === s);
const eff = (c: Combatant, k: 'atk' | 'def' | 'matk' | 'mdef') => {
  const down = (k === 'atk' || k === 'matk') ? has(c, 'atk_down') : has(c, 'def_down');
  return down ? Math.floor(c[k] * 0.7) : c[k];
};
export function turnOrder(cs: Combatant[]) {
  return cs.filter((c) => c.hp > 0).slice().sort((a, b) => b.agi - a.agi || (a.side === b.side ? a.id.localeCompare(b.id) : a.side === 'player' ? -1 : 1));
}
const alive = (s: BattleState, side: 'player' | 'enemy') => s.combatants.filter((c) => c.side === side && c.hp > 0);
export function validateCommand(s: BattleState, actorId: string, cmd: Command, inv: Record<string, number>) {
  const a = s.combatants.find((c) => c.id === actorId);
  if (s.status !== 'active') throw new BattleError('battle_over');
  if (!a || a.side !== 'player' || a.hp <= 0) throw new BattleError('invalid_actor');
  const enemy = (t?: string) => { const e = s.combatants.find((c) => c.id === t && c.side === 'enemy' && c.hp > 0); if (!e) throw new BattleError('invalid_target'); };
  switch (cmd?.type) {
    case 'attack': enemy(cmd.target); break;
    case 'skill': {
      const sk = SKILLS[cmd.skillId]; if (!sk || !a.skills?.includes(cmd.skillId)) throw new BattleError('unknown_skill');
      if (has(a, 'silence')) throw new BattleError('silenced');
      if (a.mp < sk.mp) throw new BattleError('not_enough_mp');
      if (sk.target === 'enemy') enemy(cmd.target); break;
    }
    case 'item': if (!BATTLE_ITEMS[cmd.itemId]) throw new BattleError('unknown_item'); if (!(inv[cmd.itemId] > 0)) throw new BattleError('no_item'); break;
    case 'defend': case 'flee': if (cmd.type === 'flee' && !s.canFlee) throw new BattleError('cannot_flee'); break;
    default: throw new BattleError('invalid_command');
  }
}
function pickEnemyAction(e: Combatant, rng: Rng): EnemyAction {
  const acts = e.actions?.length ? e.actions : [{ kind: 'attack', weight: 1 } as EnemyAction];
  let r = rng() * acts.reduce((t, a) => t + a.weight, 0);
  for (const a of acts) { if ((r -= a.weight) < 0) return a; }
  return acts[acts.length - 1];
}
/**
 * Resolve one full turn. `commands` must contain a command for every alive player combatant.
 * Returns the new state (input not mutated), this turn's events and consumed items.
 */
export function resolveTurn(input: BattleState, commands: Record<string, Command>, rng: Rng, inv: Record<string, number> = {}) {
  const s: BattleState = structuredClone(input);
  const T = s.turn, ev: BattleEvent[] = [], consumed: string[] = [];
  const invLeft = { ...inv };
  for (const p of alive(s, 'player')) { if (!commands[p.id]) throw new BattleError('missing_command'); validateCommand(s, p.id, commands[p.id], invLeft); if (commands[p.id].type === 'item') invLeft[(commands[p.id] as any).itemId]--; }
  const byId = (id?: string) => s.combatants.find((c) => c.id === id);
  const push = (e: Omit<BattleEvent, 'turn'>) => ev.push({ turn: T, ...e });
  const end = () => {
    if (!alive(s, 'enemy').length) s.status = 'victory'; else if (!alive(s, 'player').length) s.status = 'defeat';
    return s.status !== 'active';
  };
  const damage = (src: Combatant, tgt: Combatant, raw: number, crit: boolean, label: string) => {
    let d = raw; if (tgt.defending || tgt.guardTurns > 0) d = Math.max(1, Math.floor(d * DEFEND_RATE));
    tgt.hp = Math.max(0, tgt.hp - d);
    push({ actor: src.id, target: tgt.id, kind: 'damage', value: d, crit, text: `${label}${crit ? ' 会心の一撃！' : ''} ${tgt.name}に${d}のダメージ` });
    if (tgt.hp > 0 && has(tgt, 'sleep')) { tgt.statuses = tgt.statuses.filter((x) => x.id !== 'sleep'); push({ target: tgt.id, kind: 'status_end', status: 'sleep', text: `${tgt.name}は目を覚ました` }); }
    if (tgt.hp > 0 && has(tgt, 'confusion') && rng() < 0.5) { tgt.statuses = tgt.statuses.filter((x) => x.id !== 'confusion'); push({ target: tgt.id, kind: 'status_end', status: 'confusion', text: `${tgt.name}は正気に戻った` }); }
    if (tgt.hp <= 0) { tgt.statuses = []; push({ target: tgt.id, kind: 'ko', text: tgt.side === 'enemy' ? `${tgt.name}をたおした！` : `${tgt.name}は力尽きた…` }); }
  };
  const inflict = (tgt: Combatant, st: StatusId, rate: number) => {
    if (tgt.hp <= 0 || rng() >= rate) return;
    const cur = tgt.statuses.find((x) => x.id === st);
    if (cur) cur.turns = STATUS_DEFS[st].turns; else tgt.statuses.push({ id: st, turns: STATUS_DEFS[st].turns });
    push({ target: tgt.id, kind: 'status', status: st, text: `${tgt.name}は${STATUS_DEFS[st].name}状態になった` });
  };
  const physical = (a: Combatant, t: Combatant, mult: number, label: string) => { const crit = rng() < critRate(a.luk); damage(a, t, physicalDamage(eff(a, 'atk'), eff(t, 'def'), mult, rng, crit), crit, label); };
  const magic = (a: Combatant, t: Combatant, mult: number, label: string, element?: string) => {
    const crit = rng() < critRate(a.luk) / 2; const weak = !!element && !!t.weakTo?.includes(element);
    damage(a, t, Math.floor(magicDamage(eff(a, 'matk'), eff(t, 'mdef'), mult, rng, crit) * (weak ? 1.5 : 1)), crit, label + (weak ? '（弱点！）' : ''));
  };
  // defend is declared before anyone acts (standard command-RPG rule)
  for (const p of alive(s, 'player')) if (commands[p.id].type === 'defend') { p.defending = true; push({ actor: p.id, kind: 'defend', text: `${p.name}は身を守っている` }); }
  for (const a of turnOrder(s.combatants)) {
    if (a.hp <= 0 || s.status !== 'active') continue;
    if (has(a, 'sleep')) { push({ actor: a.id, kind: 'skip', status: 'sleep', text: `${a.name}は眠っている` }); continue; }
    if (has(a, 'paralysis') && rng() < 0.5) { push({ actor: a.id, kind: 'skip', status: 'paralysis', text: `${a.name}はしびれて動けない` }); continue; }
    const foes = alive(s, a.side === 'player' ? 'enemy' : 'player');
    if (has(a, 'confusion') && rng() < 0.5) {
      const pool = s.combatants.filter((c) => c.hp > 0 && c.id !== a.id);
      const t = pool[Math.floor(rng() * pool.length)];
      if (t) { push({ actor: a.id, kind: 'confused', text: `${a.name}は混乱している！` }); physical(a, t, 1, `${a.name}の攻撃！`); if (end()) break; continue; }
    }
    if (a.side === 'enemy') {
      const act = pickEnemyAction(a, rng); const t = foes[Math.floor(rng() * foes.length)]; if (!t) break;
      const label = act.kind === 'skill' ? `${a.name}の${act.name}！` : `${a.name}の攻撃！`;
      if (act.magic) magic(a, t, act.mult ?? 1, label); else physical(a, t, act.mult ?? 1, label);
      if (act.inflict) inflict(t, act.inflict.status, act.inflict.rate);
      if (end()) break; continue;
    }
    const cmd = commands[a.id];
    if (cmd.type === 'defend') continue;
    if (cmd.type === 'attack') { const t = byId(cmd.target)!.hp > 0 ? byId(cmd.target)! : foes[0]; if (t) physical(a, t, 1, `${a.name}の攻撃！`); }
    else if (cmd.type === 'skill') {
      const sk = SKILLS[cmd.skillId]; if (has(a, 'silence')) { push({ actor: a.id, kind: 'skip', status: 'silence', text: `${a.name}は沈黙していてスキルを使えない` }); continue; }
      a.mp -= sk.mp;
      if (sk.type === 'physical' || sk.type === 'magic') { const t = (byId(cmd.target)?.hp ?? 0) > 0 ? byId(cmd.target)! : foes[0]; if (t) (sk.type === 'physical' ? physical(a, t, sk.power, `${a.name}の${sk.name}！`) : magic(a, t, sk.power, `${a.name}の${sk.name}！`, sk.element)); }
      else if (sk.type === 'heal') { const t = byId(cmd.target)?.side === 'player' && byId(cmd.target)!.hp > 0 ? byId(cmd.target)! : a; const v = Math.max(1, Math.floor(eff(a, 'matk') * sk.power * rand(rng))); const before = t.hp; t.hp = Math.min(t.maxHp, t.hp + v); push({ actor: a.id, target: t.id, kind: 'heal', value: t.hp - before, text: `${a.name}の${sk.name}！ ${t.name}のHPが${t.hp - before}回復` }); }
      else { a.guardTurns = 2; a.defending = true; push({ actor: a.id, kind: 'guard', text: `${a.name}の${sk.name}！ 2ターンの間 被ダメージ半減` }); }
    } else if (cmd.type === 'item') {
      const it = BATTLE_ITEMS[cmd.itemId]; consumed.push(cmd.itemId); const t = a;
      if (it.heal) { const before = t.hp; t.hp = Math.min(t.maxHp, t.hp + it.heal); push({ actor: a.id, target: t.id, kind: 'heal', value: t.hp - before, text: `${a.name}は${it.name}を使った！ HPが${t.hp - before}回復` }); }
      if (it.cure) { t.statuses = t.statuses.filter((x) => !it.cure!.includes(x.id)); push({ actor: a.id, target: t.id, kind: 'cure', text: `${a.name}は${it.name}を使った！ 状態異常が治った` }); }
    } else if (cmd.type === 'flee') {
      const ps = alive(s, 'player'), es = alive(s, 'enemy');
      const ch = fleeChance(ps.reduce((t, p) => t + p.level, 0) / ps.length, Math.max(...es.map((e) => e.level)), ps.reduce((t, p) => t + p.agi, 0) / ps.length, Math.max(...es.map((e) => e.agi)));
      if (rng() < ch) { s.status = 'fled'; push({ actor: a.id, kind: 'flee', value: Math.round(ch * 100), text: `${a.name}は逃げ出した！` }); break; }
      push({ actor: a.id, kind: 'flee_fail', value: Math.round(ch * 100), text: `${a.name}は逃げ出そうとした…しかし回り込まれた！` });
    }
    if (end()) break;
  }
  // end of turn: poison ticks, durations, defend reset
  if (s.status === 'active') for (const c of s.combatants) {
    if (c.hp <= 0) continue;
    if (has(c, 'poison')) { const d = Math.max(1, Math.floor(c.maxHp * 0.08)); c.hp = Math.max(0, c.hp - d); push({ target: c.id, kind: 'poison', value: d, status: 'poison', text: `${c.name}は毒で${d}のダメージ` }); if (c.hp <= 0) push({ target: c.id, kind: 'ko', text: `${c.name}は力尽きた…` }); }
    for (const st of c.statuses) st.turns--;
    for (const st of c.statuses.filter((x) => x.turns <= 0)) push({ target: c.id, kind: 'status_end', status: st.id, text: `${c.name}の${STATUS_DEFS[st.id].name}が治った` });
    c.statuses = c.statuses.filter((x) => x.turns > 0);
  }
  for (const c of s.combatants) { c.defending = false; if (c.guardTurns > 0) c.guardTurns--; }
  end();
  if (s.status !== 'active') push({ kind: 'end', text: { victory: '戦闘に勝利した！', defeat: '全滅してしまった…', fled: 'うまく逃げ切れた', active: '' }[s.status] });
  s.turn = T + 1; s.log.push(...ev);
  return { state: s, events: ev, consumed };
}
/** Rewards are decided by the server from the defeated enemies (exp adjusted by level difference). */
export function computeRewards(s: BattleState, playerLevel: number, rng: Rng) {
  let exp = 0, gold = 0; const drops: Record<string, number> = {};
  for (const e of s.combatants) if (e.side === 'enemy' && e.hp <= 0 && e.reward) {
    exp += expFromMonster(e.reward.exp, e.level, playerLevel);
    gold += Math.floor(e.reward.gold * rand(rng));
    for (const d of e.reward.drops) if (rng() < d.rate) drops[d.itemId] = (drops[d.itemId] ?? 0) + d.min + Math.floor(rng() * (d.max - d.min + 1));
  }
  return { exp, gold, drops: Object.entries(drops).map(([itemId, qty]) => ({ itemId, qty })) };
}
