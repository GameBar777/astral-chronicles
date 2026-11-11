/** PHASE 9 DOM panels: player market [B] (browse / buy / list / my listings & history) and rankings [R]. All values come from the server. */
import { MARKET, marketFee } from '@astral/shared';
import { api, errText, type CharacterDto } from './api';
import { shell, newRequestId, refreshChar } from './panels';
import { confirmBox } from './dungeonBus';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const icon = (id: string) => `<img class="ic" src="/sprites/icon_${id}.png" onerror="this.style.visibility='hidden'" alt="">`;
const ERR: Record<string, string> = { market_town_only: '取引所はアステリアの街の中でのみ利用できます', listing_not_found: '出品が見つかりません', listing_closed: 'この出品は終了しています',
  listing_expired: '出品期間が終了しています', own_listing: '自分（同じアカウント）の出品は購入できません', price_changed: '価格が変更されています。再表示してください',
  too_many_listings: `出品は同時に${MARKET.maxActivePerCharacter}件までです`, invalid_price: `価格は${MARKET.minPrice}〜${MARKET.maxPrice.toLocaleString()}Gで指定してください`,
  invalid_duration: '出品期間が不正です', not_enough_gold: 'ゴールドが足りません', inventory_full: '持ち物がいっぱいです', equipped: '装備中のアイテムは出品できません',
  cannot_sell: 'それは出品できません', not_enough_materials: '数量が足りません', invalid_qty: '数量が不正です', in_battle: '戦闘中はできません', item_not_found: 'アイテムが見つかりません' };
const err = (e: unknown) => { const t = errText(e); return ERR[(e as any)?.code] ?? t; };
const ST: Record<string, string> = { active: '出品中', sold: '売却済', cancelled: '取消', reclaimed: '期限切れ回収', expired: '期限切れ（回収待ち）' };
const left = (iso: string) => { const ms = new Date(iso).getTime() - Date.now(); if (ms <= 0) return '終了'; const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3); return h ? `残り${h}時間${m}分` : `残り${m}分`; };

export async function openMarket(c: CharacterDto, onChar: (c: CharacterDto) => void, tab: 'browse' | 'sell' | 'mine' = 'browse') {
  const { body, msg } = shell('取引所（プレイヤー市場）', 'market');
  let busy = false, q = '', cur = tab;
  const run = async (fn: () => Promise<string>) => { if (busy) return; busy = true; try { msg(await fn(), true); c = await refreshChar(c, onChar); } catch (e) { msg(err(e)); } finally { busy = false; await render(); } };
  const tabs = () => `<div class="m-tabs">${(['browse', 'sell', 'mine'] as const).map((t) => `<button class="m-tab ${t === cur ? 'on' : ''}" data-tab="${t}">${{ browse: '購入', sell: '出品', mine: '出品状況・履歴' }[t]}</button>`).join('')}
    <span class="g">${Number(c.gold).toLocaleString()} G</span></div>`;
  async function render() {
    if (cur === 'browse') {
      const d = await api('GET', `/market?search=${encodeURIComponent(q)}`);
      body.innerHTML = tabs() + `<div class="m-search"><input id="m-q" maxlength="30" placeholder="アイテム名で検索" value="${esc(q)}"><button id="m-go">検索</button></div>
        <div class="m-list">${d.listings.map((l: any) => `<div class="m-row r-${l.rarity}" data-l="${l.id}">${icon(l.itemId)}<span class="nm">${esc(l.name)}${l.enhance ? ` +${l.enhance}` : ''} ×${l.quantity}</span>
          <span class="sub">${esc(l.seller)}・${left(l.expiresAt)}</span><b class="pr">${Number(l.price).toLocaleString()} G</b>
          ${l.sellerId === c.id ? '<small>自分の出品</small>' : `<button class="m-buy" data-id="${l.id}" data-price="${l.price}" data-name="${esc(l.name)}">購入</button>`}</div>`).join('') || '<div class="s-none">出品はありません</div>'}</div>`;
    } else if (cur === 'sell') {
      const d = await api('GET', `/characters/${c.id}/items`);
      const items = d.items.filter((i: any) => !i.equipped && i.category !== 'quest');
      body.innerHTML = tabs() + `<div class="m-sell"><label>アイテム<select id="m-item">${items.map((i: any) => `<option value="${i.id}" data-qty="${i.qty}">${esc(i.name)}${i.enhance ? ` +${i.enhance}` : ''}（所持${i.qty}）</option>`).join('')}</select></label>
        <label>数量<input id="m-qty" type="number" min="1" value="1"></label><label>価格（合計G）<input id="m-price" type="number" min="${MARKET.minPrice}" max="${MARKET.maxPrice}" value="100"></label>
        <label>期間<select id="m-h">${MARKET.durationsH.map((h) => `<option value="${h}" ${h === 24 ? 'selected' : ''}>${h}時間</option>`).join('')}</select></label>
        <div class="m-fee" id="m-fee"></div><button id="m-list-btn" ${items.length ? '' : 'disabled'}>出品する</button>
        <div class="r-note">出品中のアイテムは取引所が預かります。売れると手数料${Math.round(MARKET.feeRate * 100)}%（最低1G）を引いた額が届きます。期限切れ・取消で返却されます。</div></div>`;
      const fee = () => { const p = Math.floor(Number((body.querySelector('#m-price') as HTMLInputElement).value) || 0); body.querySelector('#m-fee')!.textContent = p > 0 ? `手数料 ${marketFee(p)}G／受取予定 ${(p - marketFee(p)).toLocaleString()}G` : ''; };
      body.querySelector('#m-price')!.addEventListener('input', fee); fee();
    } else {
      const d = await api('GET', `/characters/${c.id}/market`);
      const st = (l: any) => (l.expired ? 'expired' : l.status);
      body.innerHTML = tabs() + `<h4>自分の出品</h4><div class="m-list">${d.listings.map((l: any) => `<div class="m-row">${icon(l.itemId)}<span class="nm">${esc(l.name)}${l.enhance ? ` +${l.enhance}` : ''} ×${l.quantity}</span>
          <span class="sub">${ST[st(l)]}${l.status === 'sold' ? `・${esc(l.buyer)}・手数料${l.fee}G` : l.status === 'active' && !l.expired ? '・' + left(l.expiresAt) : ''}</span><b class="pr">${Number(l.price).toLocaleString()} G</b>
          ${l.status === 'active' ? `<button class="m-cancel" data-id="${l.id}">${l.expired ? '回収' : '取消'}</button>` : ''}</div>`).join('') || '<div class="s-none">なし</div>'}</div>
        <h4>購入履歴</h4><div class="m-list">${d.purchases.map((l: any) => `<div class="m-row">${icon(l.itemId)}<span class="nm">${esc(l.name)} ×${l.quantity}</span><span class="sub">${esc(l.seller)} から</span><b class="pr">${Number(l.price).toLocaleString()} G</b></div>`).join('') || '<div class="s-none">なし</div>'}</div>`;
    }
  }
  for (const ev of ['keydown', 'keyup'] as const) body.addEventListener(ev, (e) => { if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName) && (e as KeyboardEvent).key !== 'Escape') e.stopPropagation(); }); // typing never moves the character; Esc still closes
  body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset.tab) { cur = t.dataset.tab as any; msg(''); render(); return; }
    if (t.id === 'm-go') { q = (body.querySelector('#m-q') as HTMLInputElement).value.trim(); render(); return; }
    if (t.classList.contains('m-buy')) { const price = Number(t.dataset.price);
      confirmBox(`${esc(t.dataset.name)} を <b>${price.toLocaleString()}G</b> で購入しますか？`, '購入する').then((ok) => { if (ok) run(async () => { const r = await api('POST', `/characters/${c.id}/market/buy`, { listingId: t.dataset.id, expectedPrice: price, requestId: newRequestId() }); return `${r.name}×${r.qty} を購入しました（-${r.price}G）`; }); }); }
    if (t.id === 'm-list-btn') { const v = (s: string) => (body.querySelector(s) as HTMLInputElement).value;
      run(async () => { const r = await api('POST', `/characters/${c.id}/market/list`, { inventoryId: v('#m-item'), qty: Number(v('#m-qty')), price: Number(v('#m-price')), hours: Number(v('#m-h')), requestId: newRequestId() });
        return `${r.name}×${r.qty} を ${r.price}G で出品しました`; }); }
    if (t.classList.contains('m-cancel')) run(async () => { const r = await api('POST', `/characters/${c.id}/market/cancel`, { listingId: t.dataset.id, requestId: newRequestId() }); return r.status === 'reclaimed' ? '期限切れの出品を回収しました' : '出品を取り消しました'; });
  });
  await render().catch((e) => msg(err(e)));
}

export async function openRanking(kind: 'level' | 'guild' | 'dungeon' = 'level') {
  const { body, msg } = shell('ランキング', 'ranking');
  const CLS: Record<string, string> = { warrior: '戦士', knight: '騎士', mage: '魔法使い', priest: '僧侶' };
  const render = async () => {
    const d = await api('GET', `/rankings/${kind}`);
    const head = { level: '<th>名前</th><th>職業</th><th>Lv</th><th>ギルド</th>', guild: '<th>ギルド</th><th>マスター</th><th>人数</th><th>合計Lv</th>', dungeon: '<th>名前</th><th>職業</th><th>Lv</th><th>遺跡踏破</th>' }[kind];
    const row = (r: any) => kind === 'guild' ? `<td>${esc(r.name)}</td><td>${esc(r.leader)}</td><td>${r.members}</td><td>${r.score}</td>`
      : `<td>${esc(r.name)}</td><td>${CLS[r.class] ?? r.class}</td><td>${r.level}</td><td>${kind === 'level' ? esc(r.guild ?? '—') : r.clears + '回'}</td>`;
    body.innerHTML = `<div class="m-tabs">${(['level', 'guild', 'dungeon'] as const).map((k) => `<button class="m-tab ${k === kind ? 'on' : ''}" data-k="${k}">${{ level: 'レベル', guild: 'ギルド', dungeon: 'ダンジョン' }[k]}</button>`).join('')}</div>
      <table class="rk"><thead><tr><th>#</th>${head}</tr></thead><tbody>${d.rows.map((r: any) => `<tr class="${r.rank <= 3 ? 'top' + r.rank : ''}"><td>${r.rank}</td>${row(r)}</tr>`).join('') || '<tr><td colspan="5">データがありません</td></tr>'}</tbody></table>
      <div class="r-note">30秒ごとに更新（集計 ${new Date(d.at).toLocaleTimeString('ja-JP')}）</div>`;
  };
  body.addEventListener('click', (e) => { const k = (e.target as HTMLElement).dataset.k; if (k) { kind = k as any; render().catch((x) => msg(errText(x))); } });
  await render().catch((e) => msg(errText(e)));
}
