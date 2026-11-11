import { SLOT_NAMES, EQUIP_SLOTS, CATEGORY_NAMES, type EquipSlot, type EquipCategory } from '@astral/shared';
import { api, errText, type CharacterDto } from './api';
/** PHASE 4 DOM panels: inventory/equipment (I key) and the smith (craft + enhance). Every number shown comes from the server. */
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
import { sfx } from './audio';
export const newRequestId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
let root: HTMLDivElement | null = null;
export const panelOpen = () => !!root;
export function closePanel() { root?.remove(); root = null; }
const icon = (id: string) => `<img class="ic" src="/sprites/icon_${id}.png" onerror="this.style.visibility='hidden'" alt="">`;
const stat = (e: any) => ['atk', 'def', 'matk', 'mdef'].filter((k) => e?.[k]).map((k) => `${k.toUpperCase()}+${e[k]}`).join(' ');
const ERR: Record<string, string> = { level_too_low: 'レベルが足りません', class_cannot_equip: 'この職業では装備できません', not_equipment: '装備品ではありません', already_full: 'これ以上回復できません',
  not_usable: '今は使えません', inventory_full: '持ち物がいっぱいです', not_enough_gold: 'ゴールドが足りません', not_enough_materials: '素材が足りません', craft_busy: '製作中のものがあります',
  not_ready: 'まだ完成していません', already_claimed: '受け取り済みです', too_far: '離れすぎています', max_enhance: 'これ以上強化できません', two_handed: '両手剣を装備中は盾を装備できません',
  node_not_ready: 'まだ採集できません', gather_level_too_low: '採集レベルが足りません', in_battle: '戦闘中です', not_at_portal: '出口の位置がずれています',
  quest_active: '受注中です', quest_done: '受注できません（達成済み）', quest_incomplete: 'まだ条件を満たしていません', already_rewarded: '報酬は受け取り済みです', quest_not_active: '受注していません',
  cannot_sell: 'それは売れません', equipped: '装備中は売れません', not_sold_here: 'ここでは売っていません', invalid_qty: '数量が不正です' };
export const itemErr = (e: unknown) => { const t = errText(e); return ERR[t] ?? t; };
export function shell(title: string, cls = '') {
  closePanel(); root = document.createElement('div'); root.id = 'p4'; root.className = `p4 ${cls}`;
  root.innerHTML = `<div class="p4-head"><span>${title}</span><button class="x" title="閉じる (I/Esc)">✕</button></div><div class="p4-body"></div><div class="p4-msg"></div>`;
  document.body.appendChild(root); root.querySelector<HTMLButtonElement>('.x')!.onclick = closePanel;
  const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { closePanel(); window.removeEventListener('keydown', onKey); } }; window.addEventListener('keydown', onKey);
  return { body: root.querySelector<HTMLDivElement>('.p4-body')!, msg: (t: string, ok = false) => { const m = root?.querySelector<HTMLDivElement>('.p4-msg'); if (m) { m.textContent = t; m.className = `p4-msg ${ok ? 'ok' : 'ng'}`; } } };
}
export async function refreshChar(c: CharacterDto, onChar: (c: CharacterDto) => void) {
  const fresh = (await api<CharacterDto[]>('GET', '/characters').catch(() => [])).find((x) => x.id === c.id); if (fresh) onChar(fresh); return fresh ?? c;
}
export async function openInventory(c: CharacterDto, onChar: (c: CharacterDto) => void) {
  const { body, msg } = shell('持ち物・装備', 'inv');
  let busy = false;
  const render = async () => {
    const d = await api('GET', `/characters/${c.id}/items`);
    const eq = Object.fromEntries(d.items.filter((i: any) => i.equipped).map((i: any) => [i.equipped, i]));
    const slots = EQUIP_SLOTS.map((s: EquipSlot) => { const it = eq[s];
      return `<div class="slot ${it ? 'on' : ''}" ${it ? `data-un="${s}"` : ''} title="${it ? 'クリックで外す' : ''}"><small>${SLOT_NAMES[s]}</small>${it ? `${icon(it.itemId)}<span>${esc(it.name)}${it.enhance ? ` +${it.enhance}` : ''}</span>` : '<span class="none">—</span>'}</div>`; }).join('');
    const T = d.stats.total, Bn = d.stats.bonus;
    const list = d.items.filter((i: any) => !i.equipped).map((i: any) => `<button class="it r-${i.rarity}" data-id="${i.id}" data-cat="${i.category}">${icon(i.itemId)}<span class="nm">${esc(i.name)}${i.enhance ? ` +${i.enhance}` : ''}</span>
      <span class="sub">${i.equip ? `${CATEGORY_NAMES[i.equip.category as EquipCategory]} Lv${i.equip.levelReq} ${stat(i.equip)}` : esc(i.description ?? '')}</span><span class="q">${i.qty > 1 ? `×${i.qty}` : ''}</span></button>`).join('');
    body.innerHTML = `<div class="eqgrid">${slots}</div>
      <div class="stats">ATK <b>${T.atk}</b><i>(+${Bn.atk})</i> DEF <b>${T.def}</b><i>(+${Bn.def})</i> MATK <b>${T.matk}</b><i>(+${Bn.matk})</i> MDEF <b>${T.mdef}</b><i>(+${Bn.mdef})</i><span class="g">${d.gold.toLocaleString()} G</span></div>
      <div class="cap">持ち物 ${d.slotsUsed}/${d.slotsMax}　<small>装備品:クリックで装備　消耗品:クリックで使用</small></div><div class="items">${list || '<div class="none">なにもない</div>'}</div>`;
    body.querySelectorAll<HTMLElement>('[data-un]').forEach((el) => (el.onclick = () => act(() => api('POST', `/characters/${c.id}/unequip`, { slot: el.dataset.un }), '外した')));
    body.querySelectorAll<HTMLButtonElement>('.it').forEach((el) => (el.onclick = () => {
      if (el.dataset.cat === 'equipment') act(() => api('POST', `/characters/${c.id}/equip`, { inventoryId: el.dataset.id }), '装備した');
      else if (el.dataset.cat === 'consumable') act(async () => { const r = await api('POST', `/characters/${c.id}/use`, { inventoryId: el.dataset.id, requestId: newRequestId() }); sfx('heal'); return { text: `${r.name}を使った（HP+${r.healed} MP+${r.mpHealed}）` }; }, '');
    }));
  };
  const act = async (fn: () => Promise<any>, okText: string) => {
    if (busy) return; busy = true;
    try { const r = await fn(); msg(r?.text ?? okText, true); c = await refreshChar(c, onChar); await render(); } catch (e) { msg(itemErr(e)); } finally { busy = false; }
  };
  await render().catch((e) => msg(itemErr(e)));
}
export async function openSmith(c: CharacterDto, onChar: (c: CharacterDto) => void) {
  const { body, msg } = shell('鍛冶屋 ゴルド「何を打とうか？」', 'smith');
  let tab: 'craft' | 'enhance' = 'craft', busy = false; let timer = 0;
  const render = async () => {
    clearInterval(timer);
    const [d, recipes, job] = await Promise.all([api('GET', `/characters/${c.id}/items`), api('GET', '/recipes'), api('GET', `/characters/${c.id}/crafting`)]);
    const have = (id: string) => d.items.filter((i: any) => i.itemId === id && !i.equipped).reduce((t: number, i: any) => t + i.qty, 0);
    const name = (id: string) => d.items.find((i: any) => i.itemId === id)?.name ?? ({ copper_ore: '銅鉱石', iron_ore: '鉄鉱石', magic_stone: '魔石', wood: '木材', herb: '薬草', beast_hide: '獣の皮' } as any)[id] ?? id;
    const tabs = `<div class="tabs"><button data-tab="craft" class="${tab === 'craft' ? 'on' : ''}">製作</button><button data-tab="enhance" class="${tab === 'enhance' ? 'on' : ''}">強化</button><span class="g">${d.gold.toLocaleString()} G</span></div>`;
    let inner = '';
    if (tab === 'craft') {
      const j = job.job;
      const jobHtml = j ? `<div class="job">製作中: ${esc(recipes.find((r: any) => r.id === j.recipeId)?.resultName ?? j.recipeId)} <span id="jt">${Math.ceil(j.readyInMs / 1000)}秒</span> <button id="claim" ${j.readyInMs > 0 ? 'disabled' : ''}>受け取る</button></div>` : '';
      inner = jobHtml + recipes.map((r: any) => { const ok = r.materials.every((m: any) => have(m.itemId) >= m.qty) && d.gold >= r.goldCost && c.level >= r.requiredLevel;
        return `<div class="rc ${ok ? '' : 'dim'}">${icon(r.resultItemId)}<div class="rn">${esc(r.resultName)}${r.resultQty > 1 ? ` ×${r.resultQty}` : ''}<small>Lv${r.requiredLevel}・${r.craftTimeSec}秒${r.goldCost ? `・${r.goldCost}G` : ''}</small></div>
          <div class="mats">${r.materials.map((m: any) => `<span class="${have(m.itemId) >= m.qty ? '' : 'lack'}">${icon(m.itemId)}${esc(name(m.itemId))} ${have(m.itemId)}/${m.qty}</span>`).join('')}</div>
          <button data-r="${r.id}" ${ok && !j ? '' : 'disabled'}>作る</button></div>`; }).join('');
    } else {
      const eqs = d.items.filter((i: any) => i.equip);
      const infos = await Promise.all(eqs.map((i: any) => api('GET', `/enhance-info/${i.enhance}`)));
      inner = eqs.map((i: any, k: number) => { const inf = infos[k];
        const ok = inf && d.gold >= inf.gold && inf.materials.every((m: any) => have(m.itemId) >= m.qty);
        return `<div class="rc ${ok ? '' : 'dim'}">${icon(i.itemId)}<div class="rn">${esc(i.name)} <b>+${i.enhance}</b>${i.equipped ? '<small>装備中</small>' : ''}<small>${stat(i.equip)}</small></div>
          <div class="mats">${inf ? `<span>成功率 ${Math.round(inf.rate * 100)}%</span><span class="${d.gold >= inf.gold ? '' : 'lack'}">${inf.gold}G</span>${inf.materials.map((m: any) => `<span class="${have(m.itemId) >= m.qty ? '' : 'lack'}">${icon(m.itemId)}${esc(name(m.itemId))} ${have(m.itemId)}/${m.qty}</span>`).join('')}` : '<span>最大強化</span>'}</div>
          <button data-e="${i.id}" ${ok ? '' : 'disabled'}>強化</button></div>`; }).join('') + '<div class="note">※失敗しても装備は壊れません（ゴールドと素材は消費）</div>';
    }
    body.innerHTML = tabs + `<div class="rlist">${inner}</div>`;
    body.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab as any; render(); }));
    body.querySelectorAll<HTMLButtonElement>('[data-r]').forEach((b) => (b.onclick = () => run(() => api('POST', `/characters/${c.id}/craft`, { recipeId: b.dataset.r, requestId: newRequestId() }), () => '製作を開始した')));
    body.querySelectorAll<HTMLButtonElement>('[data-e]').forEach((b) => (b.onclick = () => run(() => api('POST', `/characters/${c.id}/enhance`, { inventoryId: b.dataset.e, requestId: newRequestId() }),
      (r) => (sfx(r.success ? 'enhance' : 'hit'), r.success ? `強化成功！ ${r.name} +${r.to}` : `強化失敗… ${r.name} は +${r.from} のまま`), (r) => r.success)));
    const cl = body.querySelector<HTMLButtonElement>('#claim');
    if (cl && job.job) {
      cl.onclick = () => run(() => api('POST', `/characters/${c.id}/craft/${job.job.id}/claim`), (r) => `${r.item.name} ×${r.item.qty} が完成した！`);
      const end = Date.now() + job.job.readyInMs;
      timer = window.setInterval(() => { const jt = body.querySelector('#jt'); if (!jt) return clearInterval(timer); const left = Math.max(0, Math.ceil((end - Date.now()) / 1000)); jt.textContent = `${left}秒`; if (!left) { cl.disabled = false; clearInterval(timer); } }, 250);
    }
  };
  const run = async (fn: () => Promise<any>, text: (r: any) => string, good: (r: any) => boolean = () => true) => {
    if (busy) return; busy = true;
    try { const r = await fn(); msg(text(r), good(r)); c = await refreshChar(c, onChar); await render(); } catch (e) { msg(itemErr(e)); } finally { busy = false; }
  };
  await render().catch((e) => msg(itemErr(e)));
}
