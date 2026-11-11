/** Staff-only admin console. Talks to existing /api/admin/* and /api/auth/*; role comes from /api/me. */
const tokenKey = 'astral.token';
const token = () => sessionStorage.getItem(tokenKey) || localStorage.getItem(tokenKey) || '';
const setToken = (t: string) => { sessionStorage.setItem(tokenKey, t); };
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch('/api' + path, { method, headers: { 'content-type': 'application/json', ...(token() ? { authorization: 'Bearer ' + token() } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok) { const e: any = new Error(j?.error ?? String(r.status)); e.status = r.status; e.body = j; throw e; }
  return j;
};
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const msg = (id: string, t: string, ok = false) => { const el = $(id); el.textContent = t; el.className = 'msg ' + (ok ? 'ok' : 'ng'); };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let me: { userId: string; role: string; email?: string } | null = null;

async function boot() {
  if (!token()) return showLogin();
  try {
    me = await api('GET', '/me');
    if (me?.role !== 'gm' && me?.role !== 'admin') { sessionStorage.removeItem(tokenKey); return showLogin('このアカウントには管理権限がありません'); }
    showApp();
  } catch { showLogin(); }
}
function showLogin(err = '') {
  $('#login').hidden = false; $('#app').hidden = true; $('#login-msg').textContent = err;
  $('#login-btn').onclick = async () => {
    $('#login-msg').textContent = '';
    try {
      const r = await api('POST', '/auth/login', { email: ($('#email') as HTMLInputElement).value, password: ($('#pw') as HTMLInputElement).value });
      setToken(r.token); await boot();
    } catch (e: any) { $('#login-msg').textContent = e.body?.error === 'maintenance' ? 'メンテナンス中です（スタッフは入れます。権限をご確認ください）' : (e.message === 'unauthorized' || e.status === 401 ? 'メールまたはパスワードが違います' : String(e.message)); }
  };
}
function showApp() {
  $('#login').hidden = true; $('#app').hidden = false;
  $('#who').textContent = `${me!.role === 'admin' ? '管理者' : 'GM'}  (${me!.email ?? me!.userId.slice(0, 8)})`;
  ($('#tab-grant') as HTMLButtonElement).hidden = me!.role !== 'admin';
  $('#out').onclick = async () => { try { await api('POST', '/auth/logout'); } catch {} sessionStorage.removeItem(tokenKey); location.reload(); };
  document.querySelectorAll('#tabs button').forEach((b) => (b as HTMLButtonElement).onclick = () => {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    const t = (b as HTMLElement).dataset.t;
    document.querySelectorAll('main section').forEach((s) => ((s as HTMLElement).hidden = (s as HTMLElement).dataset.p !== t));
    if (t === 'status') loadStatus(); if (t === 'news') loadNews(); if (t === 'logs') loadLogs();
  });
  $('#mnt-on').onclick = () => setMaint(true); $('#mnt-off').onclick = () => setMaint(false);
  $('#nw-add').onclick = addNews;
  $('#mu-go').onclick = doMute;
  $('#ba-on').onclick = () => doBan(true); $('#ba-off').onclick = () => doBan(false);
  $('#gr-go').onclick = doGrant; $('#lg-go').onclick = loadLogs;
  loadStatus();
}
async function loadStatus() {
  try {
    const s = await api('GET', '/admin/status');
    const m = s.maintenance?.on ?? s.maintenance === true;
    $('#st-body').innerHTML = `<p>メンテナンス: <b class="${m ? 'ng' : 'ok'}">${m ? 'ON' : 'OFF'}</b> ${esc(s.maintenance?.message ?? s.message ?? '')}</p>
      <p>オンライン: <b>${Number(s.online ?? 0)}</b> 人　登録: ${s.users ?? '?'} 人 / キャラ ${s.characters ?? '?'}</p>
      <p>稼働 ${s.uptimeSec ?? '?'} 秒　RSS ${s.rssMB ?? '?'} MB　取引所出品 ${s.listings ?? 0}　進行中ダンジョン ${s.dungeons ?? 0}</p>`;
  } catch (e: any) { $('#st-body').textContent = '取得失敗: ' + e.message; }
}
async function setMaint(on: boolean) {
  try { await api('POST', '/admin/maintenance', { on, message: ($('#mnt-msg') as HTMLInputElement).value }); msg('#st-msg', on ? 'メンテナンスを開始しました' : '解除しました', true); await loadStatus(); }
  catch (e: any) { msg('#st-msg', e.message === 'forbidden' ? '管理者のみ操作できます' : e.message); }
}
async function loadNews() {
  try {
    const list = await api('GET', '/announcements');
    $('#news-list').innerHTML = list.length ? `<ul>${list.map((a: any) => `<li><b>${esc(a.title)}</b> — ${esc(a.body)}</li>`).join('')}</ul>` : '<p>なし</p>';
  } catch (e: any) { $('#news-list').textContent = e.message; }
}
async function addNews() {
  try {
    const hours = ($('#nw-hours') as HTMLInputElement).value;
    await api('POST', '/admin/announcements', { title: ($('#nw-title') as HTMLInputElement).value, body: ($('#nw-body') as HTMLTextAreaElement).value, ...(hours ? { hours: Number(hours) } : {}) });
    msg('#nw-msg', '掲載しました', true); ($('#nw-title') as HTMLInputElement).value = ''; ($('#nw-body') as HTMLTextAreaElement).value = ''; await loadNews();
  } catch (e: any) { msg('#nw-msg', e.message); }
}
async function doMute() {
  try { const minutes = Number(($('#mu-min') as HTMLInputElement).value); await api('POST', '/admin/mute', { name: ($('#mu-name') as HTMLInputElement).value, minutes }); msg('#mod-msg', minutes ? `${minutes}分の発言制限をかけました` : '制限を解除しました', true); }
  catch (e: any) { msg('#mod-msg', e.message); }
}
async function doBan(ban: boolean) {
  try { await api('POST', '/admin/ban', { name: ($('#ba-name') as HTMLInputElement).value, ban }); msg('#mod-msg', ban ? 'アカウントを停止しました' : '停止を解除しました', true); }
  catch (e: any) { msg('#mod-msg', e.message); }
}
async function doGrant() {
  try {
    const r = await api('POST', '/admin/grant', { name: ($('#gr-name') as HTMLInputElement).value, itemId: ($('#gr-item') as HTMLInputElement).value, qty: Number(($('#gr-qty') as HTMLInputElement).value), grantId: ($('#gr-id') as HTMLInputElement).value });
    msg('#gr-msg', r.granted ? '付与しました' : '同じ grantId のため再付与しませんでした（冪等）', true);
  } catch (e: any) { msg('#gr-msg', e.message); }
}
async function loadLogs() {
  try {
    const q = ($('#lg-q') as HTMLInputElement).value.trim();
    const rows = await api('GET', '/admin/logs' + (q ? `?action=${encodeURIComponent(q)}` : ''));
    $('#lg-body').innerHTML = `<table><thead><tr><th>時刻</th><th>操作</th><th>対象</th><th>詳細</th><th>IP</th></tr></thead><tbody>
      ${rows.map((r: any) => `<tr><td>${esc(r.at)}</td><td>${esc(r.action)}</td><td>${esc(r.target)}</td><td><code>${esc(JSON.stringify(r.detail))}</code></td><td>${esc(r.ip)}</td></tr>`).join('') || '<tr><td colspan="5">なし</td></tr>'}
    </tbody></table>`;
  } catch (e: any) { $('#lg-body').textContent = e.message; }
}
boot();
