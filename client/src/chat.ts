/** Chat panel (Local / Party / Guild / System). PHASE 7: sent over the world room socket ('chat'), server-stored,
 * spam-checked server side. All text is HTML-escaped before rendering. */
const TABS = ['Local', 'Party', 'Guild', 'System'] as const;
type Tab = typeof TABS[number];
const CH: Record<string, Tab> = { local: 'Local', party: 'Party', guild: 'Guild', system: 'System', whisper: 'Local' };
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ERR: Record<string, string> = { rate_limited: '送信が速すぎます', duplicate: '同じ内容の連続送信はできません', muted: '現在発言が制限されています（スパム対策/運営による制限）',
  not_in_party: 'パーティーに参加していません', blocked: '相手に届きませんでした', target_offline: '相手はオフラインです', target_not_found: 'そのキャラクターは見つかりません', self: '自分には送れません', invalid_name: '宛先を入力してください（/w 名前 本文）', not_in_guild: 'ギルドに所属していません', system_readonly: 'Systemタブには送信できません', invalid_body: '1〜200文字で入力してください', offline: 'サーバー未接続のため送信できません' };
export type ChatMsg = { id?: number; channel: string; body: string; from?: { id: string; name: string }; to?: { id: string; name: string }; at?: string };
type Sender = (channel: string, body: string, to?: string) => boolean;
export const chatBus = { send: null as Sender | null, onMsg: (_m: ChatMsg) => {}, onHistory: (_h: ChatMsg[]) => {}, onError: (_c: string) => {}, system: (_s: string) => {}, notice: (_m: any) => {} };
export function mountChat(root: HTMLElement, _playerName: string) {
  const logs: Record<Tab, string[]> = { Local: [], Party: [], Guild: [], System: [] }; const seen = new Set<number>();
  const line = (m: ChatMsg) => {
    const tab = CH[m.channel] ?? 'System';
    if (m.channel === 'whisper') return { tab, html: `<span class="c-ch c-whisper">[ささやき]</span> <span class="c-name">${esc(m.from?.name ?? '')}</span> → <span class="c-name">${esc(m.to?.name ?? '')}</span>: ${esc(m.body)}` };
    const tag = tab === 'Local' ? '' : `<span class="c-ch c-${m.channel}">[${tab}]</span> `;
    return { tab, html: m.from ? `${tag}<span class="c-name">${esc(m.from.name)}</span>: ${esc(m.body)}` : `<span class="c-sys">[System] ${esc(m.body)}</span>` };
  };
  const add = (m: ChatMsg) => {
    if (m.id != null) { if (seen.has(m.id)) return; seen.add(m.id); }
    const { tab, html } = line(m); logs[tab].push(html); if (tab !== 'Local' && tab !== 'System') logs.Local.push(html); if (tab === 'System') logs.Local.push(html);
    for (const t of TABS) if (logs[t].length > 200) logs[t].splice(0, logs[t].length - 200);
    if (tab !== cur && !(cur === 'Local')) el.querySelector(`[data-t="${tab}"]`)?.classList.add('new');
  };
  const el = document.createElement('div'); el.id = 'chat';
  el.innerHTML = `<div class="tabs">${TABS.map((t) => `<button data-t="${t}">${t}</button>`).join('')}</div><div class="log"></div><div class="c-err"></div><form><input maxlength="200" placeholder="メッセージを入力（Enter）" /><button type="submit">送信</button></form>`;
  root.appendChild(el);
  let cur: Tab = 'Local';
  const log = el.querySelector('.log') as HTMLDivElement, input = el.querySelector('input') as HTMLInputElement, err = el.querySelector('.c-err') as HTMLDivElement;
  const render = () => { el.querySelectorAll('.tabs button').forEach((b) => { const on = (b as HTMLElement).dataset.t === cur; b.classList.toggle('on', on); if (on) b.classList.remove('new'); });
    log.innerHTML = logs[cur].map((l) => `<div>${l}</div>`).join(''); log.scrollTop = log.scrollHeight;
    input.disabled = cur === 'System'; input.placeholder = cur === 'System' ? 'Systemは受信専用です' : `${cur}に送信（Enter）`; };
  let errT: any; const showErr = (c: string) => { err.textContent = ERR[c] ?? c; clearTimeout(errT); errT = setTimeout(() => (err.textContent = ''), 4000); };
  chatBus.onMsg = (m) => { add(m); render(); };
  chatBus.onHistory = (h) => { for (const m of h) add(m); render(); };
  chatBus.onError = showErr;
  (window as any).__chatBus = chatBus; // test hook
  chatBus.system = (s) => { add({ channel: 'system', body: s }); render(); };
  chatBus.notice = (n) => { const t = n?.type === 'maintenance' ? `メンテナンス: ${n.message ?? ''}` : n?.type === 'announcement' ? `お知らせ: ${n.title ?? ''}` : n?.type === 'banned' ? 'アカウントが利用停止になりました' : ''; if (t) chatBus.system(t); };
  el.querySelectorAll('.tabs button').forEach((b) => ((b as HTMLButtonElement).onclick = () => { cur = (b as HTMLElement).dataset.t as Tab; render(); }));
  el.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault(); const m = input.value.trim(); if (!m || cur === 'System') return;
    const w = /^\/(?:w|whisper|ささやく)\s+(\S+)\s+(.+)$/i.exec(m); // whisper: /w 名前 本文
    if (/^\/w(hisper)?\b/i.test(m) && !w) { showErr('invalid_name'); return; }
    if (!chatBus.send || !(w ? chatBus.send('whisper', w[2], w[1]) : chatBus.send(cur.toLowerCase(), m))) { showErr('offline'); return; }
    input.value = ''; input.blur();
  });
  for (const ev of ['keydown', 'keyup'] as const) input.addEventListener(ev, (e) => e.stopPropagation()); // keep WASD from moving while typing
  add({ channel: 'system', body: 'アステリアへようこそ！ [O] フレンド/パーティー/ギルド　ささやき: /w 名前 本文' }); render();
  return el;
}
