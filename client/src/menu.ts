/** PHASE 10 main menu (SECTION 17): キャラクター/装備/持ち物/スキル/クエスト/マップ/フレンド/パーティー/ギルド/取引所/ランキング/お知らせ/設定.
 * Opened with [M] or the HUD button; every entry opens a real panel. */
import { CLASSES, SKILLS, type MapData } from '@astral/shared';
import { api, type CharacterDto } from './api';
import { shell, closePanel, panelOpen } from './panels';
import { audioSettings, setAudio, sfx } from './audio';
import { CLASS_JA } from './ui';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export type MenuHooks = { char: () => CharacterDto; map: () => { data: MapData; x: number; y: number } | null; inventory: () => void; quests: () => void; social: () => void; market: () => void; ranking: () => void };
const ITEMS: [string, string, string][] = [['char', 'キャラクター', 'C'], ['inv', '装備・持ち物', 'I'], ['skill', 'スキル', 'K'], ['quest', 'クエスト', 'L'], ['map', 'マップ', 'N'],
  ['social', 'フレンド・パーティー・ギルド', 'O'], ['market', '取引所', 'B'], ['rank', 'ランキング', 'R'], ['news', 'お知らせ', ''], ['settings', '設定', '']];
export function openMenu(h: MenuHooks) {
  const { body } = shell('メニュー', 'menu');
  body.innerHTML = `<div class="mn-grid">${ITEMS.map(([k, t, key]) => `<button class="mn" data-m="${k}">${t}${key ? `<small>[${key}]</small>` : ''}</button>`).join('')}</div>`;
  body.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('button')?.dataset.m; if (k) { sfx('menu'); openEntry(k, h); } });
}
export function openEntry(k: string, h: MenuHooks) {
  if (k === 'inv') return h.inventory(); if (k === 'quest') return h.quests(); if (k === 'market') return h.market(); if (k === 'rank') return h.ranking();
  if (k === 'social') { closePanel(); return h.social(); }
  if (k === 'char') return openCharacter(h.char()); if (k === 'skill') return openSkills(h.char()); if (k === 'map') return openMap(h.map());
  if (k === 'news') return openNews(); if (k === 'settings') return openSettings();
}
function openCharacter(c: CharacterDto) {
  const { body } = shell('キャラクター', 'char');
  const row = (a: string, v: unknown) => `<div class="cs-row"><b>${a}</b><span>${esc(v)}</span></div>`;
  body.innerHTML = `<div class="cs"><div class="cs-name">${esc(c.name)} <small>${CLASS_JA[c.class]} Lv.${c.level}</small></div>
    ${row('HP', `${c.hp} / ${c.max_hp}`)}${row('MP', `${c.mp} / ${c.max_mp}`)}${row('EXP', c.exp)}${row('所持金', `${Number(c.gold).toLocaleString()} G`)}
    ${row('STR', c.str)}${row('VIT', c.vit)}${row('INT', c.int)}${row('AGI', c.agi)}${row('LUK', c.luk)}
    ${row('ATK（素）', c.atk)}${row('DEF（素）', c.def)}${row('MATK（素）', c.matk)}${row('MDEF（素）', c.mdef)}</div><div class="r-note">装備補正込みの値は「装備・持ち物」に表示されます</div>`;
}
function openSkills(c: CharacterDto) {
  const { body } = shell('スキル', 'skills');
  const ids = CLASSES[c.class as keyof typeof CLASSES]?.startingSkills ?? [];
  const T: Record<string, string> = { physical: '物理', magic: '魔法', heal: '回復', guard: '防御' };
  body.innerHTML = ids.map((id) => { const s = SKILLS[id]; return s ? `<div class="sk"><b>${esc(s.name)}</b><span>${T[s.type] ?? s.type}</span><span>MP ${s.mp}</span><span>${s.power ? `威力 ×${s.power}` : '2ターン被ダメージ半減'}</span>${s.element ? `<span>属性 ${esc(s.element)}</span>` : ''}</div>` : ''; }).join('')
    + '<div class="r-note">スキルは戦闘中の「スキル」コマンドで使用します。上級スキルは今後追加予定（未実装）</div>';
}
function openMap(m: { data: MapData; x: number; y: number } | null) {
  const { body } = shell('マップ', 'mapp');
  if (!m) { body.innerHTML = '<div class="s-none">このエリアでは表示できません</div>'; return; }
  const { data } = m, gd = data.layers.find((l) => l.name === 'ground')!.data, S = Math.max(3, Math.floor(Math.min(520 / data.width, 380 / data.height)));
  const cv = document.createElement('canvas'); cv.width = data.width * S; cv.height = data.height * S; cv.className = 'minimap'; const g = cv.getContext('2d')!;
  const COL: Record<number, string> = { 1: '#4f8a3a', 2: '#b8a78a', 3: '#8a6a44', 4: '#3a6ac0' };
  for (let y = 0; y < data.height; y++) for (let x = 0; x < data.width; x++) { g.fillStyle = COL[gd[y * data.width + x]] ?? '#2a2a2a'; g.fillRect(x * S, y * S, S, S); }
  const dot = (x: number, y: number, c: string, r = 3) => { g.fillStyle = c; g.beginPath(); g.arc(x / 32 * S, y / 32 * S, r, 0, Math.PI * 2); g.fill(); };
  const legend: string[] = [];
  for (const o of data.objects) {
    if (o.type === 'npc') dot(o.x, o.y, '#ffe08a'); else if (o.type === 'portal') { dot(o.x, o.y, '#c080ff', 4); legend.push(`◆ ${o.label ?? ({ green_meadow: '緑の草原へ', asteria: 'アステリアへ' } as Record<string, string>)[String(o.props?.to)] ?? o.id}`); } else if (o.type === 'dungeon') { dot(o.x, o.y, '#ff5a5a', 5); legend.push(`● ${o.label ?? 'ダンジョン'}`); }
  }
  dot(m.x, m.y, '#ffffff', 4); g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath(); g.arc(m.x / 32 * S, m.y / 32 * S, 4, 0, Math.PI * 2); g.stroke();
  body.innerHTML = `<div class="mp-name">${esc(data.name)} <small>推奨Lv ${data.recommendedLevel.join('〜')}</small></div>`;
  body.appendChild(cv);
  const lg = document.createElement('div'); lg.className = 'r-note'; lg.innerHTML = `○自分 <span style="color:#ffe08a">●NPC</span> <span style="color:#c080ff">◆出入口</span> <span style="color:#ff5a5a">●ダンジョン</span><br>${legend.map(esc).join('　')}`; body.appendChild(lg);
}
async function openNews() {
  const { body, msg } = shell('お知らせ', 'news');
  try { const list = await api('GET', '/announcements');
    body.innerHTML = list.map((a: any) => `<div class="nw"><b>${esc(a.title)}</b><small>${new Date(a.startsAt).toLocaleString('ja-JP')}</small><p>${esc(a.body)}</p></div>`).join('') || '<div class="s-none">お知らせはありません</div>';
  } catch { msg('読み込みに失敗しました'); }
}
function openSettings() {
  const { body } = shell('設定', 'settings'); const s = audioSettings();
  body.innerHTML = `<label class="st">BGM 音量 <input id="st-bgm" type="range" min="0" max="100" value="${Math.round(s.bgm * 100)}"></label>
    <label class="st">効果音 音量 <input id="st-sfx" type="range" min="0" max="100" value="${Math.round(s.sfx * 100)}"></label>
    <label class="st"><input id="st-mute" type="checkbox" ${s.muted ? 'checked' : ''}> すべての音を消す</label>
    <div class="r-note">BGM・効果音は本作用にブラウザ内で合成したオリジナル音源です（外部音源不使用）。設定はこの端末に保存されます。<br>操作: WASD/矢印 移動、E 調べる、M メニュー、Enter チャット、/w 名前 本文 でささやき</div>`;
  const v = (id: string) => Number((body.querySelector(id) as HTMLInputElement).value) / 100;
  body.querySelector('#st-bgm')!.addEventListener('input', () => setAudio({ bgm: v('#st-bgm') }));
  body.querySelector('#st-sfx')!.addEventListener('input', () => { setAudio({ sfx: v('#st-sfx') }); sfx('menu'); });
  body.querySelector('#st-mute')!.addEventListener('change', (e) => setAudio({ muted: (e.target as HTMLInputElement).checked }));
}
export { panelOpen };
