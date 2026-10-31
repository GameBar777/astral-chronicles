export const NAME_MIN = 2, NAME_MAX = 12;
const ALLOWED = /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}A-Za-z0-9ー・]+$/u;
/** Banned substrings (checked after NFKC + lowercase). Extend via server config later. */
export const BANNED_WORDS = ['admin', 'gamemaster', 'gm', 'system', 'moderator', '運営', '管理者', 'システム', 'fuck', 'shit', 'ちんこ', 'まんこ', '死ね', 'しね', 'ころす', '殺す'];
export type NameError = 'too_short' | 'too_long' | 'invalid_chars' | 'digits_only' | 'banned';
export function normalizeName(raw: string): string { return raw.normalize('NFKC').trim(); }
export function validateCharacterName(raw: unknown): { ok: true; name: string } | { ok: false; error: NameError } {
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_chars' };
  const name = normalizeName(raw); const len = [...name].length;
  if (len < NAME_MIN) return { ok: false, error: 'too_short' };
  if (len > NAME_MAX) return { ok: false, error: 'too_long' };
  if (!ALLOWED.test(name)) return { ok: false, error: 'invalid_chars' };
  if (/^[0-9]+$/.test(name)) return { ok: false, error: 'digits_only' };
  const low = name.toLowerCase();
  if (BANNED_WORDS.some((w) => low.includes(w))) return { ok: false, error: 'banned' };
  return { ok: true, name };
}
export const APPEARANCE_LIMITS = { bodyType: ['a', 'b'], hairStyle: 4, hairColor: 6, skinColor: 4 } as const;
export interface Appearance { bodyType: 'a' | 'b'; hairStyle: number; hairColor: number; skinColor: number; }
export function validateAppearance(a: any): a is Appearance {
  const int = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < max;
  return !!a && typeof a === 'object' && (a.bodyType === 'a' || a.bodyType === 'b') && int(a.hairStyle, 4) && int(a.hairColor, 6) && int(a.skinColor, 4)
    && Object.keys(a).length === 4;
}
export const NAME_ERROR_JA: Record<NameError | 'taken', string> = {
  too_short: `名前は${NAME_MIN}文字以上にしてください`, too_long: `名前は${NAME_MAX}文字以内にしてください`,
  invalid_chars: '使用できない文字が含まれています', digits_only: '数字のみの名前は使えません', banned: '使用できない語句が含まれています',
  taken: 'その名前は既に使われています',
};
