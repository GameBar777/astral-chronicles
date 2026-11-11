/** PHASE 7 social panel: friends / party / guild (REST), refreshed by server 'social' push events. Toggle with [O]. */
import { api, errText } from './api';
import { confirmBox, promptBox } from './dungeonBus';
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const CLS: Record<string, string> = { warrior: '戦士', knight: '騎士', mage: '魔法使い', priest: '僧侶' };
let el: HTMLDivElement | null = null, cid = '', data: any = null, msg = '', msgOk = true;
export const socialBus = { refresh: () => { if (el && !el.classList.contains('hidden')) load(); } };
export function mountSocial(root: HTMLElement, characterId: string) {
  cid = characterId; el?.remove(); el = document.createElement('div'); el.id = 'social'; el.className = 'p4 hidden'; root.appendChild(el);
  el.addEventListener('click', onClick);
  for (const ev of ['keydown', 'keyup'] as const) el.addEventListener(ev, (e) => { if ((e.target as HTMLElement).tagName === 'INPUT') e.stopPropagation(); });
  return el;
}
export const socialOpen = () => !!el && !el.classList.contains('hidden');
export function toggleSocial() { if (!el) return; el.classList.toggle('hidden'); if (socialOpen()) load(); }
async function load() { try { data = await api('GET', `/characters/${cid}/social`); } catch (e) { msg = errText(e); msgOk = false; } render(); }
async function act(path: string, body: any, ok: string) {
  try { await api('POST', `/characters/${cid}/${path}`, body); msg = ok; msgOk = true; } catch (e) { msg = errText(e); msgOk = false; } await load();
}
const st = (m: any) => `${m.online ? '<span class="s-on">●</span>' : '<span class="s-off">○</span>'}${m.inBattle ? '<span class="s-bt" title="戦闘中">戦闘中</span>' : ''}`;
const who = (m: any) => `${st(m)} <b>${esc(m.name)}</b> <small>${CLS[m.cls] ?? m.cls ?? ''} Lv${m.level ?? '?'}${m.map ? ' / ' + esc(m.map) : ''}</small>`;
function render() {
  if (!el || !data) return; const d = data, me = d.me?.id ?? cid, lead = d.party?.leader === me;
  const inv = d.invites.map((i: any) => `<div class="s-row">${i.kind === 'party' ? 'パーティー' : 'ギルド'}招待: <b>${esc(i.from)}</b>${i.name ? ' (' + esc(i.name) + ')' : ''}
    <button data-a="${i.kind}/accept" data-id="${i.id}">参加</button><button data-a="invites/decline" data-kind="${i.kind}" data-id="${i.id}">断る</button></div>`).join('');
  const party = d.party ? d.party.members.map((m: any) => `<div class="s-row">${d.party.leader === m.id ? '<span class="s-lead">★</span>' : ''}${who(m)}
      ${lead && m.id !== me ? `<button data-a="party/leader" data-id="${m.id}">リーダー</button><button data-a="party/kick" data-id="${m.id}">追放</button>` : ''}</div>`).join('')
      + `<button data-a="party/leave">パーティーを抜ける</button>`
    : '<div class="s-none">未参加</div><button data-a="party/create">パーティー作成</button>';
  const RK: Record<string, string> = { leader: 'マスター', officer: 'オフィサー', member: 'メンバー' }, my = d.guild?.rank;
  const gBtns = (m: any) => m.id === me ? '' : (my === 'leader' ? `${m.rank === 'member' ? `<button data-a="guild/rank" data-rank="officer" data-id="${m.id}">昇格</button>` : `<button data-a="guild/rank" data-rank="member" data-id="${m.id}">降格</button>`}<button data-a="guild/transfer" data-id="${m.id}">譲渡</button><button data-a="guild/kick" data-id="${m.id}">追放</button>`
    : my === 'officer' && m.rank === 'member' ? `<button data-a="guild/kick" data-id="${m.id}">追放</button>` : '');
  const guild = d.guild ? `<div class="s-g">${esc(d.guild.name)} <small>(${RK[d.guild.rank] ?? d.guild.rank})</small></div>` + d.guild.members.map((m: any) => `<div class="s-row">${who(m)} <small class="s-rk ${m.rank}">${RK[m.rank] ?? m.rank}</small>${gBtns(m)}</div>`).join('')
    + `<button data-a="guild/leave">ギルド脱退</button>${my === 'leader' ? '<button data-a="guild/disband" class="danger">ギルド解散</button>' : ''}`
    : '<div class="s-none">未所属</div><input id="s-gname" maxlength="16" placeholder="ギルド名(2-16)"/><button data-a="guild/create">ギルド作成</button>';
  el.innerHTML = `<div class="p4-head">フレンド / パーティー / ギルド <button class="x" data-a="close">×</button></div><div class="p4-msg ${msgOk ? 'ok' : 'ng'}">${esc(msg)}</div><div class="p4-body">
    ${inv ? `<h4>招待</h4>${inv}` : ''}
    <h4>パーティー (${d.party ? d.party.members.length : 0}/4)</h4>${party}
    <div class="s-inv"><input id="s-pname" maxlength="16" placeholder="キャラ名"/>${!d.party || lead ? '<button data-a="party/invite">パーティー招待</button>' : ''}${d.guild && d.guild.rank !== 'member' ? '<button data-a="guild/invite">ギルド招待</button>' : ''}<button data-a="friends/request">フレンド申請</button></div>
    <h4>フレンド (${d.friends.length})</h4>${d.friends.map((f: any) => `<div class="s-row">${who(f)} <button data-a="friends/remove" data-id="${f.id}">削除</button></div>`).join('') || '<div class="s-none">なし</div>'}
    ${d.incoming.length ? `<h4>申請が届いています</h4>${d.incoming.map((f: any) => `<div class="s-row"><b>${esc(f.name)}</b> <button data-a="friends/accept" data-id="${f.id}">承認</button></div>`).join('')}` : ''}
    ${d.outgoing.length ? `<div class="s-none">申請中: ${d.outgoing.map((f: any) => esc(f.name)).join(', ')}</div>` : ''}
    <h4>ギルド</h4>${guild}</div>`;
}
function onClick(e: Event) {
  const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b || !el) return;
  const a = b.dataset.a!, id = b.dataset.id, name = (el.querySelector('#s-pname') as HTMLInputElement | null)?.value.trim() ?? '';
  if (a === 'close') return toggleSocial();
  const map: Record<string, [any, string]> = {
    'party/create': [{}, 'パーティーを作成しました'], 'party/invite': [{ name }, `${name} を招待しました`], 'party/accept': [{ partyId: id }, 'パーティーに参加しました'],
    'party/leave': [{}, 'パーティーを抜けました'], 'party/kick': [{ characterId: id }, '追放しました'], 'party/leader': [{ characterId: id }, 'リーダーを譲りました'],
    'invites/decline': [{ kind: b.dataset.kind, id }, '招待を断りました'], 'friends/request': [{ name }, `${name} にフレンド申請しました`],
    'friends/accept': [{ characterId: id }, 'フレンドになりました'], 'friends/remove': [{ characterId: id }, 'フレンドを削除しました'],
    'guild/create': [{ name: (el.querySelector('#s-gname') as HTMLInputElement | null)?.value.trim() }, 'ギルドを作成しました'], 'guild/invite': [{ name }, `${name} をギルドに招待しました`],
    'guild/accept': [{ guildId: id }, 'ギルドに参加しました'], 'guild/leave': [{}, 'ギルドを脱退しました'] };
  map['guild/rank'] = [{ characterId: id, rank: b.dataset.rank }, b.dataset.rank === 'officer' ? 'オフィサーに昇格しました' : 'メンバーに降格しました'];
  map['guild/kick'] = [{ characterId: id }, 'ギルドから追放しました'];
  if (a === 'guild/transfer') { confirmBox('ギルドマスターを譲渡しますか？<br><small>あなたはオフィサーになります</small>', '譲渡する').then((ok) => { if (ok) act(a, { characterId: id }, 'ギルドマスターを譲渡しました'); }); return; }
  if (a === 'guild/disband') { promptBox(`解散するにはギルド名「${esc(data?.guild?.name ?? '')}」を入力してください`, '解散する').then((n) => { if (n !== null) act(a, { confirmName: n }, 'ギルドを解散しました'); }); return; }
  if (map[a]) act(a, ...map[a]);
}
