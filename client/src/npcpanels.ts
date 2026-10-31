import { NPCS, innCost } from '@astral/shared';
import { api, type CharacterDto } from './api';
import { shell, refreshChar, itemErr, newRequestId, openSmith, closePanel } from './panels';
/** PHASE 5: NPC dialogue window -> shop / inn / smith / quests. All prices, rewards and checks are server-side. */
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const icon = (id: string) => `<img class="ic" src="/sprites/icon_${id}.png" onerror="this.style.visibility='hidden'" alt="">`;
const PORTRAIT: Record<string, string> = { npc_shop_mira: 'npc_shop', npc_inn_hana: 'npc_inn', npc_chief_bram: 'npc_chief', npc_smith_gord: 'npc_smith' };
const OBJ = (o: any) => o.type === 'kill' ? `${({ slime: 'スライム' } as any)[o.monsterId] ?? o.monsterId}を倒す ${o.have}/${o.qty}` : o.type === 'collect' ? `${({ herb: '薬草' } as any)[o.itemId] ?? o.itemId}を集める ${o.have}/${o.qty}` : `手紙を届ける（${NPCS[o.npcId]?.name ?? o.npcId}） ${o.have ? '所持' : '未所持'}`;
const REW = (r: any) => [r.gold ? `${r.gold}G` : '', r.exp ? `EXP ${r.exp}` : '', ...(r.items ?? []).map((i: any) => `${({ potion_small: 'やくそう', antidote: 'どくけし草' } as any)[i.itemId] ?? i.itemId}×${i.qty}`)].filter(Boolean).join(' / ');
const STATE: Record<string, string> = { available: '受注可', active: '受注中', rewarded: '達成済み', done_today: '本日達成', locked: 'Lv不足' };
type OnChar = (c: CharacterDto) => void;
export async function openDialog(npcId: string, c: CharacterDto, onChar: OnChar) {
  const base = NPCS[npcId] ?? { name: npcId, lines: ['……'], services: [] }; const npc = { ...base, lines: [...base.lines] };
  const { body, msg } = shell(esc(npc.name), 'dlg');
  const quests = npc.services.includes('quest') ? await api<any[]>('GET', `/characters/${c.id}/quests`).catch(() => []) : [];
  const mine = quests.filter((q) => (q.npcId === npcId && q.state !== 'locked') || (q.state === 'active' && q.turnInNpc === npcId));
  let line = 0;
  const render = () => {
    const last = line >= npc.lines.length - 1;
    const opts = !last ? '<button data-o="next">▼ つぎへ</button>' : [
      npc.services.includes('shop') ? '<button data-o="shop">買い物をする</button><button data-o="sell">売りたい</button>' : '',
      npc.services.includes('inn') ? `<button data-o="inn">泊まる（${innCost(c.level)}G・HP/MP全回復）</button>` : '',
      npc.services.includes('smith') ? '<button data-o="smith">製作・強化</button>' : '',
      mine.length ? `<button data-o="quest">依頼の話（${mine.length}）</button>` : '',
      '<button data-o="bye">さようなら</button>'].join('');
    body.innerHTML = `<div class="dlg-row">${PORTRAIT[npcId] ? `<img class="portrait" src="/sprites/${PORTRAIT[npcId]}.png" alt="">` : ''}<div class="dlg-text">${esc(npc.lines[line])}</div></div><div class="dlg-opts">${opts}</div>`;
    body.querySelectorAll<HTMLButtonElement>('[data-o]').forEach((b) => (b.onclick = () => choose(b.dataset.o!)));
  };
  const choose = async (o: string) => {
    if (o === 'next') { line++; return render(); }
    if (o === 'bye') return closePanel();
    if (o === 'shop' || o === 'sell') return openShop(npcId, c, onChar, o);
    if (o === 'smith') return openSmith(c, onChar);
    if (o === 'quest') return openQuests(npcId, c, onChar);
    if (o === 'inn') {
      try { const r = await api('POST', `/characters/${c.id}/inn`, { requestId: newRequestId() }); c = await refreshChar(c, onChar); npc.lines.push(`ゆっくり休めたかしら？（${r.cost}G）HPとMPが全回復した！`); line = npc.lines.length - 1; render(); msg(`${r.cost}G 支払った`, true); }
      catch (e) { msg(itemErr(e)); }
    }
  };
  render();
}
export async function openShop(npcId: string, c: CharacterDto, onChar: OnChar, tab: 'shop' | 'sell' = 'shop') {
  const { body, msg } = shell(`${esc(NPCS[npcId]?.name ?? '')}「いらっしゃいませ！」`, 'shop');
  let busy = false;
  const render = async () => {
    const [list, d] = await Promise.all([api<any[]>('GET', `/shops/${npcId}`), api('GET', `/characters/${c.id}/items`)]);
    const tabs = `<div class="tabs"><button data-tab="shop" class="${tab === 'shop' ? 'on' : ''}">買う</button><button data-tab="sell" class="${tab === 'sell' ? 'on' : ''}">売る</button><span class="g">${Number(d.gold).toLocaleString()} G</span></div>`;
    const rows = tab === 'shop'
      ? list.map((i) => `<div class="rc">${icon(i.itemId)}<div class="rn">${esc(i.name)}<small>${esc(i.description ?? '')}</small></div><div class="mats"><span>${i.price}G</span></div><button data-b="${i.itemId}" ${d.gold >= i.price ? '' : 'disabled'}>買う</button></div>`).join('')
      : d.items.filter((i: any) => !i.equipped && i.category !== 'quest').map((i: any) => `<div class="rc">${icon(i.itemId)}<div class="rn">${esc(i.name)}${i.enhance ? ` +${i.enhance}` : ''}<small>所持 ${i.qty}</small></div><div class="mats"><span>${i.sellPrice ?? '?'}G</span></div><button data-s="${i.id}">1つ売る</button></div>`).join('') || '<div class="none">売れるものがない</div>';
    body.innerHTML = tabs + `<div class="rlist">${rows}</div>`;
    body.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab as any; render(); }));
    body.querySelectorAll<HTMLButtonElement>('[data-b]').forEach((b) => (b.onclick = () => run(() => api('POST', `/characters/${c.id}/shop/buy`, { npcId, itemId: b.dataset.b, qty: 1, requestId: newRequestId() }), (r) => `${r.name} を買った（-${r.cost}G）`)));
    body.querySelectorAll<HTMLButtonElement>('[data-s]').forEach((b) => (b.onclick = () => run(() => api('POST', `/characters/${c.id}/shop/sell`, { npcId, inventoryId: b.dataset.s, qty: 1, requestId: newRequestId() }), (r) => `${r.name} を売った（+${r.earn}G）`)));
  };
  const run = async (fn: () => Promise<any>, text: (r: any) => string) => {
    if (busy) return; busy = true;
    try { const r = await fn(); msg(text(r), true); c = await refreshChar(c, onChar); await render(); } catch (e) { msg(itemErr(e)); } finally { busy = false; }
  };
  await render().catch((e) => msg(itemErr(e)));
}
/** npcId = null: quest log (L key), read-only list of every quest */
export async function openQuests(npcId: string | null, c: CharacterDto, onChar: OnChar) {
  const { body, msg } = shell(npcId ? `${esc(NPCS[npcId]?.name ?? '')}の依頼` : 'クエスト一覧', 'quests');
  let busy = false;
  const render = async () => {
    const all = await api<any[]>('GET', `/characters/${c.id}/quests`);
    const qs = npcId ? all.filter((q) => (q.npcId === npcId && q.state !== 'locked') || (q.state === 'active' && q.turnInNpc === npcId)) : all.filter((q) => q.state !== 'locked');
    body.innerHTML = `<div class="rlist">${qs.map((q) => {
      const canTurn = npcId && q.state === 'active' && q.turnInNpc === npcId, canAccept = npcId === q.npcId && q.state === 'available';
      return `<div class="rc q"><div class="rn">${esc(q.name)} <small class="st st-${q.state}">${STATE[q.state] ?? q.state}${q.ready ? '・報告可' : ''}</small><small>${esc(q.description)}</small>
        <small>${q.objectives.map(OBJ).join('　')}</small><small class="rw">報酬: ${esc(REW(q.rewards))}</small></div>
        ${canAccept ? `<button data-a="${q.id}">受ける</button>` : canTurn ? `<button data-c="${q.id}" ${q.ready ? '' : 'disabled'}>報告する</button>` : ''}</div>`; }).join('') || '<div class="none">依頼はない</div>'}</div>`;
    body.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) => (b.onclick = () => run(() => api('POST', `/characters/${c.id}/quests/${b.dataset.a}/accept`, { requestId: newRequestId() }), (r) => r.given?.length ? '依頼を受けた！（手紙を受け取った）' : '依頼を受けた！')));
    body.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => (b.onclick = () => run(() => api('POST', `/characters/${c.id}/quests/${b.dataset.c}/complete`, { requestId: newRequestId() }), (r) => `依頼達成！ 報酬: ${REW(r.rewards)}${r.levelUp ? `（Lv${r.levelUp.to}にアップ！）` : ''}`)));
  };
  const run = async (fn: () => Promise<any>, text: (r: any) => string) => {
    if (busy) return; busy = true;
    try { const r = await fn(); msg(text(r), true); c = await refreshChar(c, onChar); await render(); } catch (e) { msg(itemErr(e)); } finally { busy = false; }
  };
  await render().catch((e) => msg(itemErr(e)));
}
