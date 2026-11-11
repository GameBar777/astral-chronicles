const KEY = 'astral.token';
export const session = { get token() { return sessionStorage.getItem(KEY); }, set(t: string | null) { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } };
export class ApiError extends Error { constructor(public status: number, public code: string) { super(code); } }
export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch('/api' + path, { method, headers: { 'content-type': 'application/json', ...(session.token ? { authorization: `Bearer ${session.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 204) return null as T;
  const j = await r.json().catch(() => ({ error: 'network' }));
  if (!r.ok) throw new ApiError(r.status, j.error ?? 'unknown');
  return j;
}
export const ERR_JA: Record<string, string> = {
  target_not_found: 'そのキャラクターは見つかりません', self: '自分自身は指定できません', already_requested: '申請済みです', already_friends: 'すでにフレンドです', not_leader: 'リーダーのみ可能です',
  party_full: 'パーティーは満員です（最大4人）', target_in_party: '相手は別のパーティーにいます', already_in_party: 'すでにパーティーに参加しています', invite_not_found: '招待が見つからないか期限切れです',
  not_in_party: 'パーティーに参加していません', not_in_guild: 'ギルドに所属していません', not_officer: '権限がありません', guild_name_taken: 'そのギルド名は使用されています',
  invalid_guild_name: 'ギルド名は2〜16文字（記号不可）', already_in_guild: 'すでにギルドに所属しています', target_in_guild: '相手は別のギルドに所属しています', invalid_name: '名前を入力してください',
  invalid_email: 'メールアドレスの形式が正しくありません', invalid_password: 'パスワードは8〜72バイトで入力してください', email_taken: 'このメールアドレスは登録済みです',
  invalid_credentials: 'メールアドレスまたはパスワードが違います', banned: 'このアカウントは利用停止中です', rate_limited: '操作が多すぎます。しばらく待ってください',
  unauthorized: 'ログインし直してください', name_too_short: '名前は2文字以上にしてください', name_too_long: '名前は12文字以内にしてください',
  name_invalid_chars: '使用できない文字が含まれています（ひらがな・カタカナ・漢字・英数字のみ）', name_digits_only: '数字のみの名前は使えません',
  name_banned: '使用できない語句が含まれています', name_taken: 'その名前は既に使われています', character_limit: 'キャラクターは3体までです',
  not_guild_leader: 'ギルドマスターのみ可能です', not_allowed: '権限がありません', invalid_rank: '役職が不正です', member_not_found: 'メンバーが見つかりません', confirm_name_mismatch: 'ギルド名が一致しません', invalid_ranking: 'ランキングの種類が不正です',
  invalid_dungeon: 'そのダンジョンは存在しません', level_too_low: 'レベルが入場条件に達していません', reentry_cooldown: 'クリア直後のため、しばらく再入場できません（10分）', already_in_dungeon: 'すでにダンジョンに入っています', too_far: '入口から離れすぎています', wrong_map: 'ここでは入場できません',
  character_down: '戦闘不能です', in_battle: '戦闘中はできません', in_dungeon: 'ダンジョン内では使えません', not_in_dungeon: 'ダンジョンに入っていません',
  gate_not_cleared: '先に魔物を倒してください', already_cleared: 'この階の魔物は倒し済みです', already_claimed: '受け取り済みです', no_chest: '宝箱はありません',
  last_floor: 'これ以上は進めません', not_cleared: 'まだボスを倒していません', stale_turn: 'ターンが進みました。再表示します', battle_over: '戦闘は終了しています',
  invalid_class: '職業を選んでください', invalid_appearance: '外見の指定が不正です', internal: 'サーバーエラーが発生しました', network: '通信エラーが発生しました',
};
export const errText = (e: unknown) => (e instanceof ApiError ? ERR_JA[e.code] ?? e.code : ERR_JA.network);
export interface CharacterDto { id: string; name: string; class: string; appearance: { bodyType: 'a' | 'b'; hairStyle: number; hairColor: number; skinColor: number };
  level: number; exp: number; gold: number; map_id: string; pos_x: number; pos_y: number; hp: number; max_hp: number; mp: number; max_mp: number;
  str: number; vit: number; int: number; agi: number; luk: number; atk: number; def: number; matk: number; mdef: number; }
