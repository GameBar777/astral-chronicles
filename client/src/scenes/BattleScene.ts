import Phaser from 'phaser';
import { SKILLS, BATTLE_ITEMS, STATUS_DEFS, type BattleEvent } from '@astral/shared';
import { api, errText, type CharacterDto } from '../api';
const FONT = '"DotGothic16", sans-serif';
export interface BattleView { id: string; zone?: string; turn: number; status: 'active' | 'victory' | 'defeat' | 'fled'; canFlee: boolean; combatants: any[]; log: BattleEvent[];
  events?: BattleEvent[]; rewards?: { exp: number; gold: number; drops: { itemId: string; name: string; qty: number }[] } | null;
  levelUp?: { from: number; to: number; statDiff: Record<string, number> } | null; resumed?: boolean;
  dungeonInstanceId?: string | null; waiting?: boolean; pending?: string[]; deadlineAt?: string; dungeonStatus?: string }
/** PHASE 8 ruins monsters have no dedicated art yet: existing sprites recoloured (BUG-020, placeholder) */
const MON_FALLBACK: Record<string, { tex: string; tint: number; scale: number }> = {
  ruins_bat: { tex: 'mon_wild_dog', tint: 0x8a6ad0, scale: 1.7 }, ruins_skeleton: { tex: 'mon_goblin', tint: 0xe8e4d0, scale: 2 }, ruins_golem: { tex: 'mon_goblin', tint: 0x8a8f9a, scale: 3.4 } };
const STAT_JA: Record<string, string> = { maxHp: '最大HP', maxMp: '最大MP', str: 'STR', vit: 'VIT', int: 'INT', agi: 'AGI', luk: 'LUK', atk: 'ATK', def: 'DEF', matk: 'MATK', mdef: 'MDEF' };
const STAT_COL: Record<string, string> = { maxHp: 'max_hp', maxMp: 'max_mp' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/**
 * Command-select turn battle. The client only sends {turn, command}; every number shown comes from the server
 * response (state + events). Events are replayed one by one for presentation only.
 */
export class BattleScene extends Phaser.Scene {
  b!: BattleView; c!: CharacterDto; done!: (r: { status: string; levelUp: BattleView['levelUp'] }) => void;
  sprites = new Map<string, Phaser.GameObjects.Sprite | Phaser.GameObjects.Image>(); bars = new Map<string, Phaser.GameObjects.Graphics>();
  ui!: HTMLDivElement; busy = false; inv: { item_id: string; name: string; qty: number }[] = []; logLines: string[] = [];
  constructor() { super('Battle'); }
  create(data: { battle: BattleView; character: CharacterDto; onEnd: BattleScene['done'] }) {
    this.b = data.battle; this.c = data.character; this.done = data.onEnd; this.sprites.clear(); this.bars.clear(); this.logLines = [];
    const W = this.scale.width, H = this.scale.height;
    this.party = !!this.b.dungeonInstanceId; this.chain = Promise.resolve();
    const bg = this.add.image(W / 2, H / 2, 'battle_meadow'); bg.setScale(Math.max(W / bg.width, H / bg.height));
    if (this.party) { bg.setTint(0x6a5a8a); this.add.rectangle(0, 0, W, H, 0x100818, 0.35).setOrigin(0); } // underground: darkened meadow backdrop (placeholder)
    this.add.rectangle(0, H, W, H * 0.34, 0x000000, 0.25).setOrigin(0, 1);
    const enemies = this.b.combatants.filter((x) => x.side === 'enemy');
    const groundY = H * 0.62;
    enemies.forEach((e, i) => {
      const n = enemies.length, x = W * (0.2 + (n === 1 ? 0.18 : (0.36 * i) / Math.max(1, n - 1))), y = groundY + (i % 2) * 34 - (n > 1 ? 10 : 0);
      this.add.ellipse(x, y - 4, 90, 22, 0x000000, 0.28);
      const fb = this.textures.exists(`mon_${e.monsterId}`) ? null : MON_FALLBACK[e.monsterId], sc = fb?.scale ?? 2;
      const s = this.add.image(x, y, fb?.tex ?? `mon_${e.monsterId}`).setOrigin(0.5, 1).setScale(sc).setInteractive({ useHandCursor: true });
      if (fb) s.setTint(fb.tint);
      s.on('pointerdown', () => this.pickTarget?.(e.id));
      this.tweens.add({ targets: s, scaleY: sc * 1.04, scaleX: sc * 0.975, y: y - 3, duration: 520 + i * 70, yoyo: true, repeat: -1, ease: 'Sine.inOut' }); // idle breathing
      this.sprites.set(e.id, s);
      this.add.text(x, y + 6, e.name, { fontFamily: FONT, fontSize: '14px', color: '#fff', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5, 0).setName('name_' + e.id);
      this.bars.set(e.id, this.add.graphics());
      if (e.hp <= 0) s.setVisible(false);
    });
    const ps = this.b.combatants.filter((x) => x.side === 'player');
    ps.forEach((p, i) => { // party: staggered column on the right, own character in front
      const x = ps.length === 1 ? W * 0.76 : W * (0.7 + 0.09 * (i % 2)) , y = ps.length === 1 ? groundY + 30 : groundY - 40 + i * 46, sc = ps.length === 1 ? 2.7 : 2.1;
      this.add.ellipse(x, y - 4, 80, 18, 0x000000, 0.3);
      const sp = this.add.sprite(x, y, `ch_${p.characterId === this.c.id ? this.c.class : p.cls ?? 'warrior'}`, 1).setOrigin(0.5, 1).setScale(sc).setDepth(y); // left-facing frame
      this.sprites.set(p.id, sp);
      if (ps.length > 1) { this.add.text(x, y + 2, p.name, { fontFamily: FONT, fontSize: '12px', color: p.characterId === this.c.id ? '#ffe08a' : '#fff', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5, 0).setDepth(y + 1).setName('pn_' + p.id); this.bars.set(p.id, this.add.graphics().setDepth(y + 1)); }
    });
    this.mountUI(); this.refresh();
    this.addLog(this.b.resumed ? '— 戦闘を再開しました（切断前の状態をサーバーから復元） —' : this.b.log[this.b.log.length - 1]?.text ?? '');
    if (this.b.resumed) for (const ev of this.b.log.slice(-4)) this.addLog(ev.text);
    this.cameras.main.fadeIn(250);
    this.loadInventory().then(() => this.showMenu());
    this.events.once('shutdown', () => this.ui?.remove());
  }
  pickTarget?: (id: string) => void;
  async loadInventory() { try { this.inv = await api('GET', `/characters/${this.c.id}/inventory`); } catch { this.inv = []; } }
  party = false; chain: Promise<unknown> = Promise.resolve();
  me() { return this.b.combatants.find((x) => x.side === 'player' && x.characterId === this.c.id) ?? this.b.combatants.find((x) => x.side === 'player'); }
  /** PHASE 8: server push (other member resolved the turn / deadline sweep). Deduped by turn+status. */
  onPush(v: BattleView) {
    if (!this.b || v.id !== this.b.id) return;
    this.chain = this.chain.then(async () => {
      if (v.turn <= this.b.turn && v.status === this.b.status) return;
      this.busy = true; await this.play(v.events ?? []); this.b = { ...v, resumed: false }; this.refresh(); this.busy = false;
      if (v.status !== 'active') return this.finish(v);
      this.showMenu();
    });
  }
  onWait(m: { id: string; turn: number; pending: string[] }) { if (this.b && m.id === this.b.id && m.turn === this.b.turn) { this.b.pending = m.pending; if (this.b.waiting) this.showWaiting(); } }
  showWaiting() {
    const ps = this.b.combatants.filter((x) => x.side === 'player' && x.hp > 0), done = this.b.pending ?? [];
    const left = this.b.deadlineAt ? Math.max(0, Math.ceil((new Date(this.b.deadlineAt).getTime() - Date.now()) / 1000)) : 0;
    this.menu(`<div class="b-title wait" id="b-wait">仲間の行動を待っています… (${done.length}/${ps.length})</div>` +
      ps.map((p) => `<div class="b-member">${done.includes(p.id) ? '✓' : '…'} ${esc(p.name)}</div>`).join('') + (left ? `<div class="r-note">残り約${left}秒で未入力のメンバーは自動で防御</div>` : ''));
  }
  mountUI() {
    this.ui = document.createElement('div'); this.ui.id = 'battle-ui';
    this.ui.innerHTML = `<div class="b-cmd" id="b-cmd"></div><div class="b-log" id="b-log"></div><div class="b-stat" id="b-stat"></div>`;
    document.getElementById('ui')!.appendChild(this.ui);
  }
  addLog(t: string) { if (!t) return; this.logLines.push(t); this.logLines = this.logLines.slice(-6); this.ui.querySelector('#b-log')!.innerHTML = this.logLines.map((l, i) => `<div class="${i === this.logLines.length - 1 ? 'new' : ''}">${esc(l)}</div>`).join(''); }
  refresh() {
    const me = this.me();
    const st = (c: any) => c.statuses.map((s: any) => `<span class="st st-${s.id}">${STATUS_DEFS[s.id as keyof typeof STATUS_DEFS].name}</span>`).join('');
    const bar = (v: number, m: number, cls: string) => `<div class="bbar ${cls}"><i style="width:${m ? Math.round((100 * v) / m) : 0}%"></i><span>${v} / ${m}</span></div>`;
    this.ui.querySelector('#b-stat')!.innerHTML = `<div class="b-name">${esc(me.name)} <small>Lv.${me.level}</small></div>
      <div class="b-row"><b>HP</b>${bar(me.hp, me.maxHp, 'hp')}</div><div class="b-row"><b>MP</b>${bar(me.mp, me.maxMp, 'mp')}</div>
      <div class="b-sts">${st(me)}${me.defending ? '<span class="st st-guard">防御</span>' : ''}</div><div class="b-turn">ターン ${this.b.turn}</div>`;
    this.partyBars();
    for (const e of this.b.combatants.filter((x) => x.side === 'enemy')) {
      const g = this.bars.get(e.id)!, s = this.sprites.get(e.id)!; g.clear(); if (e.hp <= 0) { (this.children.getByName('name_' + e.id) as Phaser.GameObjects.Text)?.setVisible(false); continue; }
      const x = s.x - 40, y = s.y + 26, r = e.hp / e.maxHp;
      g.fillStyle(0x05070e).fillRoundedRect(x - 1, y - 1, 82, 9, 3).fillStyle(r > 0.5 ? 0x5ad05a : r > 0.25 ? 0xe0c040 : 0xe04a3a).fillRoundedRect(x, y, Math.max(3, 80 * r), 7, 3);
      const tag = e.statuses.map((x: any) => STATUS_DEFS[x.id as keyof typeof STATUS_DEFS].name).join(' ');
      const nm = this.children.getByName('name_' + e.id) as Phaser.GameObjects.Text; nm?.setText(tag ? `${e.name} [${tag}]` : e.name);
    }
  }
  partyBars() {
    if (!this.party) return;
    for (const p of this.b.combatants.filter((x) => x.side === 'player')) {
      const g = this.bars.get(p.id), s = this.sprites.get(p.id); if (!g || !s) continue; g.clear();
      const x = s.x - 30, y = s.y + 18, r = p.hp / p.maxHp;
      g.fillStyle(0x05070e).fillRoundedRect(x - 1, y - 1, 62, 7, 2).fillStyle(r > 0.5 ? 0x5ad05a : r > 0.25 ? 0xe0c040 : 0xe04a3a).fillRoundedRect(x, y, Math.max(2, 60 * r), 5, 2);
      s.setAlpha(p.hp > 0 ? 1 : 0.35);
    }
  }
  menu(html: string) { const el = this.ui.querySelector('#b-cmd') as HTMLDivElement; el.innerHTML = html; return el; }
  showMenu() {
    if (this.b.status !== 'active') return;
    if (this.b.waiting) return this.showWaiting();
    const me = this.me();
    if (me.hp <= 0) return void this.menu('<div class="b-title wait">戦闘不能… 仲間の戦いを見守っている</div>');
    const silenced = me.statuses.some((s: any) => s.id === 'silence');
    const el = this.menu(`<div class="b-title">${esc(me.name)}はどうする？</div>
      <button data-c="attack">攻撃</button><button data-c="skill" ${silenced || !me.skills?.length ? 'disabled' : ''}>スキル</button>
      <button data-c="item">アイテム</button><button data-c="defend">防御</button><button data-c="flee" ${this.b.canFlee ? '' : 'disabled'}>逃走</button>`);
    el.querySelectorAll('button').forEach((bt) => (bt.onclick = () => {
      const c = bt.dataset.c!;
      if (c === 'attack') this.chooseTarget((t) => this.send({ type: 'attack', target: t }));
      else if (c === 'defend') this.send({ type: 'defend' });
      else if (c === 'flee') this.send({ type: 'flee' });
      else if (c === 'skill') this.skillMenu(); else this.itemMenu();
    }));
  }
  back(el: HTMLElement) { const b = document.createElement('button'); b.className = 'back'; b.textContent = 'もどる'; b.onclick = () => { this.pickTarget = undefined; this.showMenu(); }; el.appendChild(b); }
  chooseTarget(fn: (id: string) => void) {
    const en = this.b.combatants.filter((x) => x.side === 'enemy' && x.hp > 0);
    if (en.length === 1) return fn(en[0].id);
    const el = this.menu(`<div class="b-title">対象を選択（敵をクリックでも可）</div>` + en.map((e) => `<button data-t="${e.id}">${esc(e.name)}</button>`).join(''));
    el.querySelectorAll('button').forEach((bt) => (bt.onclick = () => { this.pickTarget = undefined; fn(bt.dataset.t!); }));
    this.pickTarget = (id) => { if (!en.some((e) => e.id === id)) return; this.pickTarget = undefined; fn(id); };
    this.back(el);
  }
  skillMenu() {
    const me = this.me();
    const el = this.menu(`<div class="b-title">スキル</div>` + me.skills.map((id: string) => { const s = SKILLS[id];
      return `<button data-s="${id}" ${me.mp < s.mp ? 'disabled' : ''}>${esc(s.name)}<small>MP${s.mp}</small></button>`; }).join(''));
    el.querySelectorAll('button').forEach((bt) => (bt.onclick = () => { const id = bt.dataset.s!, sk = SKILLS[id];
      if (sk.target === 'enemy') this.chooseTarget((t) => this.send({ type: 'skill', skillId: id, target: t }));
      else this.send({ type: 'skill', skillId: id, target: me.id }); }));
    this.back(el);
  }
  itemMenu() {
    const usable = this.inv.filter((i) => BATTLE_ITEMS[i.item_id]);
    const el = this.menu(`<div class="b-title">アイテム</div>` + (usable.length ? usable.map((i) => `<button data-i="${i.item_id}">${esc(i.name)}<small>×${i.qty}</small></button>`).join('') : '<div class="b-empty">使えるアイテムがない</div>'));
    el.querySelectorAll('button').forEach((bt) => (bt.onclick = () => this.send({ type: 'item', itemId: bt.dataset.i!, target: this.me().id })));
    this.back(el);
  }
  async send(command: any) {
    if (this.busy) return; this.busy = true; this.menu('<div class="b-title wait">…</div>');
    try {
      const r: BattleView = await api('POST', `/battles/${this.b.id}/action`, { turn: this.b.turn, command });
      if (r.waiting) { this.b = { ...this.b, waiting: true, pending: r.pending, deadlineAt: r.deadlineAt }; this.addLog('コマンドを送信しました'); return; }
      if (r.turn <= this.b.turn && r.status === this.b.status && this.b.status === 'active') return; // push already applied it
      await this.play(r.events ?? []);
      this.b = { ...r, resumed: false }; this.refresh();
      if (command.type === 'item') await this.loadInventory();
      if (r.status !== 'active') return this.finish(r);
    } catch (e: any) {
      this.addLog(`⚠ ${errText(e)}`);
      if (e?.code === 'stale_turn' || e?.code === 'battle_over') { const a = await api('GET', `/characters/${this.c.id}/battle`).catch(() => null); if (a?.battle) { this.b = a.battle; this.refresh(); } }
    } finally { this.busy = false; this.showMenu(); }
  }
  /** Presentation only: replay server events with popups/flashes. HP shown is from the server state. */
  async play(events: BattleEvent[]) {
    const wait = (ms: number) => new Promise((r) => this.time.delayedCall(ms, r));
    for (const ev of events) {
      if (ev.kind === 'end') continue;
      this.addLog(ev.text);
      const tgt = ev.target ? this.sprites.get(ev.target) : undefined, act = ev.actor ? this.sprites.get(ev.actor) : undefined;
      if (act && (ev.kind === 'damage' || ev.kind === 'heal')) this.tweens.add({ targets: act, x: act.x + (ev.actor!.startsWith('p') ? -18 : 18), duration: 90, yoyo: true });
      if (tgt && ev.kind === 'damage') {
        await wait(110); tgt.setTintFill(0xffffff); this.time.delayedCall(80, () => tgt.clearTint());
        this.tweens.add({ targets: tgt, x: tgt.x + 6, duration: 40, yoyo: true, repeat: 2 });
        if (ev.target!.startsWith('p') && (!this.party || ev.target === this.me().id)) this.cameras.main.shake(140, 0.006);
        this.popup(tgt, String(ev.value), ev.crit ? '#ffd84a' : ev.target!.startsWith('p') ? '#ff7a6a' : '#ffffff', ev.crit ? 30 : 24);
      }
      if (tgt && (ev.kind === 'heal')) this.popup(tgt, `+${ev.value}`, '#7aff9a', 24);
      if (tgt && ev.kind === 'poison') this.popup(tgt, String(ev.value), '#c07aff', 22);
      if (tgt && ev.kind === 'status') this.popup(tgt, STATUS_DEFS[ev.status!].name, '#ffb0ff', 18);
      if (ev.kind === 'phase') ((window as any).__astralPhases ??= []).push(ev.value); // test hook
      if (ev.kind === 'phase' && act) { this.cameras.main.flash(400, 255, 60, 40); this.cameras.main.shake(500, 0.012); act.setTint(0xff6a5a); this.time.delayedCall(600, () => { const fb = MON_FALLBACK[(this.b.combatants.find((c) => c.id === ev.actor) ?? {}).monsterId]; fb ? (act as any).setTint(fb.tint) : (act as any).clearTint(); });
        const t = this.add.text(this.scale.width / 2, this.scale.height * 0.22, `PHASE ${ev.value}`, { fontFamily: FONT, fontSize: '48px', color: '#ff8a6a', stroke: '#300', strokeThickness: 8 }).setOrigin(0.5).setDepth(60).setName('phase_banner');
        this.tweens.add({ targets: t, alpha: 0, delay: 1100, duration: 500, onComplete: () => t.destroy() }); }
      if (tgt && ev.kind === 'ko' && ev.target!.startsWith('e')) this.tweens.add({ targets: tgt, alpha: 0, scaleY: 0.2, duration: 380, onComplete: () => tgt.setVisible(false) });
      await wait(ev.kind === 'damage' ? 520 : 380);
    }
  }
  popup(t: { x: number; y: number; displayHeight: number }, s: string, color: string, size: number) {
    const tx = this.add.text(t.x, t.y - t.displayHeight * 0.6, s, { fontFamily: FONT, fontSize: `${size}px`, color, stroke: '#000', strokeThickness: 5 }).setOrigin(0.5).setDepth(50);
    this.tweens.add({ targets: tx, y: tx.y - 40, alpha: { from: 1, to: 0 }, duration: 900, ease: 'Cubic.out', onComplete: () => tx.destroy() });
  }
  async finish(r: BattleView) {
    const title = { victory: '勝利！', defeat: '全滅…', fled: '逃走成功', active: '' }[r.status];
    const rw = r.rewards;
    const body = r.status === 'victory' && rw ? `<div class="r-row"><b>EXP</b><span>+${rw.exp}</span></div><div class="r-row"><b>GOLD</b><span>+${rw.gold} G</span></div>
      <div class="r-row"><b>ドロップ</b><span>${rw.drops.length ? rw.drops.map((d) => `${esc(d.name)}×${d.qty}`).join('、') : 'なし'}</span></div>`
      : r.status === 'victory' && this.party ? '<div class="r-note">報酬は付与済みです</div>'
      : r.status === 'defeat' ? `<div class="r-note">HPが30%の状態で街に戻されます（報酬なし）${this.party ? '<br>ダンジョン攻略は失敗しました' : ''}</div>` : '<div class="r-note">報酬はありません</div>';
    this.menu('');
    const win = document.createElement('div'); win.className = 'b-result'; win.id = 'b-result';
    win.innerHTML = `<div class="r-title ${r.status}">${title}</div>${body}<button id="b-close">${this.party && r.status !== 'defeat' ? 'ダンジョンに戻る' : 'フィールドに戻る'}</button>`;
    this.ui.appendChild(win);
    // bind first: the level-up effect below awaits, and a click during it must not be lost (BUG-020)
    (win.querySelector('#b-close') as HTMLButtonElement).onclick = () => { this.cameras.main.fadeOut(220); this.time.delayedCall(230, () => { this.done({ status: r.status, levelUp: r.levelUp }); this.scene.stop(); }); };
    if (r.levelUp) await this.levelUp(r.levelUp, win);
  }
  /** LEVEL UP: light pillar + rising sparkles + bouncing title + stat diff (old → new from server diff). */
  async levelUp(lu: NonNullable<BattleView['levelUp']>, win: HTMLElement) {
    const p = this.sprites.get(this.me().id)!, W = this.scale.width, H = this.scale.height;
    const pillar = this.add.graphics().setDepth(40).setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 0; i < 14; i++) pillar.fillStyle(0xfff0a0, 0.06 + i * 0.012).fillRect(p.x - 70 + i * 5, 0, 140 - i * 10, p.y);
    pillar.setScale(1, 0).setY(0); this.tweens.add({ targets: pillar, scaleY: 1, duration: 420, ease: 'Cubic.out' });
    this.tweens.add({ targets: pillar, alpha: 0.35, duration: 700, yoyo: true, repeat: -1, delay: 420 });
    this.cameras.main.flash(300, 255, 240, 170);
    for (let i = 0; i < 26; i++) {
      const s = this.add.star(p.x + Phaser.Math.Between(-60, 60), p.y - Phaser.Math.Between(0, 40), 4, 2, 6, 0xfff6c0).setDepth(41).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: s, y: s.y - Phaser.Math.Between(120, 300), alpha: 0, angle: 180, duration: Phaser.Math.Between(900, 1700), delay: i * 45, repeat: -1 });
    }
    const t = this.add.text(Math.min(W - 190, p.x), H * 0.17, 'LEVEL UP!', { fontFamily: FONT, fontSize: '64px', color: '#fff1a0', stroke: '#6a3a00', strokeThickness: 10 }).setOrigin(0.5).setDepth(60).setScale(0.2);
    t.setShadow(0, 4, '#000', 6, true, true);
    this.tweens.add({ targets: t, scale: 1, duration: 520, ease: 'Back.out' });
    this.add.text(Math.min(W - 190, p.x), H * 0.17 + 52, `Lv.${lu.from} → Lv.${lu.to}`, { fontFamily: FONT, fontSize: '26px', color: '#ffffff', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5).setDepth(60);
    const old = this.c as any;
    const rows = Object.entries(lu.statDiff).map(([k, d]) => { const before = Number(old[STAT_COL[k] ?? k] ?? 0);
      return `<div class="lu-row"><b>${STAT_JA[k] ?? k}</b><span>${before} → ${before + d}</span><em>+${d}</em></div>`; }).join('');
    const box = document.createElement('div'); box.className = 'lu-box'; box.id = 'lu-box'; box.innerHTML = `<div class="lu-title">ステータス上昇</div>${rows}<div class="r-note">HP・MPが全回復した</div>`;
    win.insertBefore(box, win.querySelector('#b-close'));
    const me = this.me(); me.level = lu.to; me.maxHp += lu.statDiff.maxHp ?? 0; me.maxMp += lu.statDiff.maxMp ?? 0; me.hp = me.maxHp; me.mp = me.maxMp; this.refresh(); // mirrors server (full heal on level up)
    await new Promise((r) => this.time.delayedCall(700, r));
  }
}
