import { CLASSES, CLASS_IDS, NAME_MAX, validateCharacterName, NAME_ERROR_JA } from '@astral/shared';
import { api, errText, session, type CharacterDto } from './api';
import { HAIR, SKIN } from './art/placeholderArt';
const ui = document.getElementById('ui')!;
const h = (html: string) => { ui.innerHTML = html; return ui; };
const $ = <T extends HTMLElement>(s: string) => ui.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const CLASS_JA = Object.fromEntries(CLASS_IDS.map((c) => [c, CLASSES[c].name]));
export function clearUI() { ui.innerHTML = ''; }

/** PHASE 10: maintenance banner + current announcements on the title screen (public endpoints, no auth). */
async function loginNews() {
  try {
    const [st, list] = await Promise.all([api<any>('GET', '/status'), api<any[]>('GET', '/announcements')]);
    const el = document.getElementById('news'); if (!el) return;
    el.innerHTML = (st.maintenance ? `<div class="maint" id="maint">メンテナンス中: ${esc(st.message || 'しばらくお待ちください')}</div>` : '')
      + list.slice(0, 3).map((a) => `<div class="nw"><b>${esc(a.title)}</b><p>${esc(a.body)}</p></div>`).join('');
  } catch { /* server unreachable: login form shows its own error */ }
}
export function showLogin(onReady: (c: CharacterDto) => void, msg = '') {
  h(`<form class="panel" id="f"><h1>ASTRAL CHRONICLES</h1><div class="sub">エルディア大陸 — 開発版</div>
    <label>メールアドレス<input id="email" type="email" autocomplete="username" required></label>
    <label>パスワード（8文字以上）<input id="pw" type="password" autocomplete="current-password" required></label>
    <div class="row"><button id="login" type="submit">ログイン</button><button id="reg" type="button" class="secondary">新規登録</button></div>
    <div class="err" id="err">${esc(msg)}</div><div class="login-news" id="news"></div></form>`);
  loginNews();
  let busy = false;
  const run = async (register: boolean) => {
    if (busy) return; busy = true; $('#err').textContent = '';
    const email = $<HTMLInputElement>('#email').value, password = $<HTMLInputElement>('#pw').value;
    try {
      if (register) await api('POST', '/auth/register', { email, password });
      const r = await api('POST', '/auth/login', { email, password }); session.set(r.token);
      await showCharacterSelect(onReady);
    } catch (e) { $('#err').textContent = errText(e); } finally { busy = false; }
  };
  $('#f').onsubmit = (e) => { e.preventDefault(); run(false); };
  $('#reg').onclick = () => run(true);
}

export async function showCharacterSelect(onReady: (c: CharacterDto) => void) {
  let chars: CharacterDto[];
  try { chars = await api('GET', '/characters'); } catch (e) { session.set(null); return showLogin(onReady, errText(e)); }
  h(`<div class="panel"><h1>キャラクター選択</h1>
    ${chars.map((c, i) => `<div class="char"><span>${esc(c.name)}　Lv${c.level} ${CLASS_JA[c.class]}</span><button data-i="${i}" class="play">冒険する</button></div>`).join('') || '<div class="sub">キャラクターがいません</div>'}
    <div class="row">${chars.length < 3 ? '<button id="new">新規作成</button>' : ''}<button id="out" class="secondary">ログアウト</button></div></div>`);
  ui.querySelectorAll<HTMLButtonElement>('.play').forEach((b) => (b.onclick = () => onReady(chars[Number(b.dataset.i)])));
  $('#new')?.addEventListener('click', () => showCreate(onReady));
  $('#out').onclick = () => logout(onReady);
}
export async function logout(onReady: (c: CharacterDto) => void) {
  try { await api('POST', '/auth/logout'); } catch { /* token may already be invalid */ }
  session.set(null); showLogin(onReady, 'ログアウトしました');
}

function showCreate(onReady: (c: CharacterDto) => void) {
  const opts = (arr: string[], label: (i: number) => string) => arr.map((_, i) => `<option value="${i}">${label(i)}</option>`).join('');
  h(`<form class="panel" id="f"><h1>キャラクター作成</h1>
    <label>名前（2〜${NAME_MAX}文字）<input id="name" maxlength="24" required></label>
    <h2>職業</h2><div class="classes">${CLASS_IDS.map((c, i) => `<label class="${i ? '' : 'sel'}"><input type="radio" name="cls" value="${c}" ${i ? '' : 'checked'}>${CLASSES[c].name}<span class="role">${CLASSES[c].role}</span></label>`).join('')}</div>
    <h2>外見</h2><div class="row">
    <label>体型<select id="body"><option value="a">タイプA</option><option value="b">タイプB</option></select></label>
    <label>髪型<select id="hs">${opts(['', '', '', ''], (i) => ['標準','ロング','ポニーテール','ツンツン / 前髪'][i])}</select></label></div>
    <div class="row"><label>髪色<select id="hc">${opts(HAIR, (i) => `髪色${i + 1}`)}</select></label>
    <label>肌色<select id="sk">${opts(SKIN, (i) => `肌色${i + 1}`)}</select></label></div>
    <div class="row"><button type="submit" id="create">作成する</button><button type="button" id="back" class="secondary">戻る</button></div>
    <div class="err" id="err"></div></form>`);
  ui.querySelectorAll<HTMLInputElement>('input[name=cls]').forEach((r) => (r.onchange = () => ui.querySelectorAll('.classes label').forEach((l) => l.classList.toggle('sel', (l.querySelector('input') as HTMLInputElement).checked))));
  $('#back').onclick = () => showCharacterSelect(onReady);
  let busy = false;
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); if (busy) return; // double-submit guard (server also enforces)
    const name = $<HTMLInputElement>('#name').value; const v = validateCharacterName(name);
    if (!v.ok) { $('#err').textContent = NAME_ERROR_JA[v.error]; return; } // UX only; server re-validates
    busy = true; $<HTMLButtonElement>('#create').disabled = true;
    try {
      const c = await api<CharacterDto>('POST', '/characters', { name, class: ($<HTMLInputElement>('input[name=cls]:checked')).value,
        appearance: { bodyType: $<HTMLSelectElement>('#body').value, hairStyle: +$<HTMLSelectElement>('#hs').value, hairColor: +$<HTMLSelectElement>('#hc').value, skinColor: +$<HTMLSelectElement>('#sk').value } });
      onReady(c);
    } catch (err) { $('#err').textContent = errText(err); } finally { busy = false; const b = $<HTMLButtonElement>('#create'); if (b) b.disabled = false; }
  };
}
