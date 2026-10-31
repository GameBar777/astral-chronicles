/** Chat panel UI (Local / Party / Guild / System tabs, log, input).
 * NOTE: networking is NOT implemented yet (SPEC chat is a later PHASE). Messages typed here are only echoed locally
 * and marked as unsent; nothing is transmitted to the server or other players. */
const TABS = ['Local', 'Party', 'Guild', 'System'] as const;
type Tab = typeof TABS[number];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export function mountChat(root: HTMLElement, playerName: string) {
  const logs: Record<Tab, string[]> = { Local: [], Party: [], Guild: [], System: [] };
  const sys = (m: string) => { logs.System.push(`<span class="c-sys">[System] ${esc(m)}</span>`); logs.Local.push(`<span class="c-sys">[System] ${esc(m)}</span>`); };
  sys('アステリアへようこそ！'); sys('チャット送信は未実装です（ローカル表示のみ）。');
  const el = document.createElement('div'); el.id = 'chat';
  el.innerHTML = `<div class="tabs">${TABS.map((t) => `<button data-t="${t}">${t}</button>`).join('')}</div><div class="log"></div><form><input maxlength="120" placeholder="メッセージを入力（Enter）" /><button type="submit">送信</button></form>`;
  root.appendChild(el);
  let cur: Tab = 'Local';
  const log = el.querySelector('.log') as HTMLDivElement, input = el.querySelector('input') as HTMLInputElement;
  const render = () => { el.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === cur)); log.innerHTML = logs[cur].map((l) => `<div>${l}</div>`).join(''); log.scrollTop = log.scrollHeight; };
  el.querySelectorAll('.tabs button').forEach((b) => ((b as HTMLButtonElement).onclick = () => { cur = (b as HTMLElement).dataset.t as Tab; render(); }));
  el.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault(); const m = input.value.trim(); if (!m) return; input.value = '';
    if (cur !== 'System') logs[cur].push(`<span class="c-name">${esc(playerName)}</span>: ${esc(m)} <span class="c-unsent">(未送信)</span>`);
    render(); input.blur();
  });
  // keep WASD from moving the character while typing
  for (const ev of ['keydown', 'keyup'] as const) input.addEventListener(ev, (e) => e.stopPropagation());
  render();
  return el;
}
