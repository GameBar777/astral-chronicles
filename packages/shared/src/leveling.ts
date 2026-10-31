export const MAX_LEVEL = 100;
/** EXP needed to go from `level` to `level+1`:  floor(30 * L^2.3 + 70 * L).  null at MAX_LEVEL. */
export function expToNext(level: number): number | null {
  if (level >= MAX_LEVEL) return null;
  return Math.floor(30 * Math.pow(level, 2.3) + 70 * level);
}
export function expTable(): { level: number; toNext: number | null; total: number }[] {
  let total = 0; const out = [];
  for (let l = 1; l <= MAX_LEVEL; l++) { out.push({ level: l, toNext: expToNext(l), total }); total += expToNext(l) ?? 0; }
  return out;
}
/**
 * `exp` = progress inside the current level. Gains overflowing into multiple levels are applied.
 * At Lv100 the EXP is fixed at 0 and further gains are discarded (reported in `discarded`).
 */
export function applyExp(level: number, exp: number, gain: number) {
  if (!Number.isInteger(gain) || gain < 0) throw new Error('invalid exp gain');
  let l = level, e = exp + gain;
  while (l < MAX_LEVEL && e >= expToNext(l)!) { e -= expToNext(l)!; l++; }
  let discarded = 0; if (l >= MAX_LEVEL) { discarded = e; e = 0; }
  return { level: l, exp: e, levelsGained: l - level, discarded };
}
/** Monster EXP adjusted by level difference (monsterLv - playerLv): +10%/lv up to 150%, -10%/lv down to 10%. */
export function expFromMonster(baseExp: number, monsterLevel: number, playerLevel: number): number {
  const f = Math.min(1.5, Math.max(0.1, 1 + 0.1 * (monsterLevel - playerLevel)));
  return Math.max(1, Math.floor(baseExp * f));
}
