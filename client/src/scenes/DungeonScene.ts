import { lookTexture } from '../art/look';
import Phaser from 'phaser';
import { Client, type Room } from 'colyseus.js';
import { api, errText, session, type CharacterDto } from '../api';
import { wsEndpoint } from '../net';
import { chatBus } from '../chat';
import { playBgm } from '../audio';
import { socialBus } from '../social';
import type { BattleView } from './BattleScene';
const FONT = '"DotGothic16", sans-serif';
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const MON_FB: Record<string, { tex: string; tint: number; scale: number }> = {
  ruins_bat: { tex: 'mon_wild_dog', tint: 0x8a6ad0, scale: 1.2 }, ruins_skeleton: { tex: 'mon_goblin', tint: 0xe8e4d0, scale: 1.4 }, ruins_golem: { tex: 'mon_goblin', tint: 0x8a8f9a, scale: 2.6 } };
export type DungeonView = { id: string; dungeonId: string; name: string; status: string; floor: number; floors: number; floorName: string; leader: string; expiresAt: string;
  isBoss: boolean; enemies: string[]; gateCleared: boolean; hasChest: boolean; chestOpened: boolean; clearClaimed: boolean; battleId: string | null;
  members: { id: string; name: string; class: string; level: number; hp: number; maxHp: number; mp: number; maxMp: number; left: boolean; online: boolean; inBattle: boolean }[] };
/**
 * PHASE 8 instance dungeon screen. All state is server-authoritative (REST); the colyseus 'dungeon' room is only the push/presence/chat channel.
 */
export class DungeonScene extends Phaser.Scene {
  c!: CharacterDto; d: DungeonView | null = null; room?: Room; client = new Client(wsEndpoint()); closed = false;
  panel!: HTMLDivElement; layer!: Phaser.GameObjects.Container; inBattle = false; leaving = false; netStatus = 'connecting';
  constructor() { super('Dungeon'); }
  init(data: { character: CharacterDto }) { this.c = data.character; this.d = null; this.closed = false; this.inBattle = false; this.leaving = false; }
  async create() {
    this.cameras.main.setBackgroundColor('#07050c'); this.cameras.main.fadeIn(300); playBgm('dungeon');
    this.layer = this.add.container(0, 0);
    this.panel = document.createElement('div'); this.panel.id = 'dungeon'; document.getElementById('ui')!.appendChild(this.panel);
    this.events.once('shutdown', () => { this.closed = true; this.panel.remove(); this.room?.leave(true).catch?.(() => {}); this.room = undefined; if (chatBus.send) chatBus.send = null; this.scale.off('resize', this.onResize, this); });
    this.scale.on('resize', this.onResize, this);
    await this.refresh();
    if (!this.d) return this.exitToWorld('ダンジョンは終了しています');
    this.connect();
  }
  onResize() { this.draw(); }
  async connect() {
    if (this.closed || !this.d) return;
    try { this.attach(await this.client.joinOrCreate('dungeon', { token: session.token, characterId: this.c.id, instanceId: this.d.id })); }
    catch { this.netStatus = 'offline'; this.renderPanel(); if (!this.closed) this.time.delayedCall(2000, () => this.connect()); }
  }
  attach(room: Room) {
    if (this.closed) { room.leave(true); return; }
    this.room = room; this.netStatus = 'online'; this.renderPanel();
    room.onMessage('dungeon', (m: any) => this.onDungeon(m));
    room.onMessage('battle', (v: BattleView) => this.onBattlePush(v));
    room.onMessage('battle_wait', (m: any) => (this.scene.get('Battle') as any)?.onWait?.(m));
    room.onMessage('chat', (m: any) => chatBus.onMsg(m)); room.onMessage('chat_history', (h: any) => chatBus.onHistory(h ?? []));
    room.onMessage('chat_error', (m: any) => chatBus.onError(m?.code)); room.onMessage('system_notice', (m: any) => chatBus.notice(m)); room.onMessage('social', () => socialBus.refresh());
    chatBus.send = (channel, body, to) => { if (this.room !== room) return false; room.send('chat', { channel, body, ...(to ? { to } : {}) }); return true; };
    room.onLeave(async (code) => {
      if (this.room === room) chatBus.send = null;
      if (this.closed || code === 4001) { this.netStatus = 'offline'; this.renderPanel(); return; }
      this.netStatus = 'reconnecting'; this.renderPanel();
      for (let i = 0; i < 6 && !this.closed; i++) {
        await new Promise((r) => setTimeout(r, 500 + i * 700));
        try { this.attach(await this.client.reconnect(room.reconnectionToken)); await this.refresh(); return; } catch { /* retry */ }
      }
      this.room = undefined; await this.refresh(); this.connect();
    });
  }
  async onDungeon(m: any) {
    if (m?.type === 'ended') { if (!this.inBattle) return this.exitToWorld(m.reason === 'expired' ? '制限時間切れでダンジョンから戻されました' : m.reason === 'failed' ? 'パーティーは全滅しました…' : 'ダンジョンを出ました'); return; }
    if (m?.type === 'battle' && !this.inBattle) { await this.refresh(); return; }
    await this.refresh();
  }
  /** a member started the fight (or a turn resolved): open / feed the battle scene */
  async onBattlePush(v: BattleView) {
    const bs = this.scene.get('Battle') as any;
    if (this.inBattle && bs?.b?.id === v.id) return bs.onPush(v);
    if (!this.inBattle && v.status === 'active') this.openBattle(v);
  }
  async refresh() {
    try { const r = await api<{ dungeon: DungeonView | null }>('GET', `/characters/${this.c.id}/dungeon`); this.d = r.dungeon; }
    catch { /* keep last */ }
    if (this.closed) return;
    if (!this.d && !this.inBattle && this.room) return this.exitToWorld('ダンジョンは終了しています');
    if (this.d?.battleId && !this.inBattle) {
      const r = await api<{ battle: BattleView | null }>('GET', `/characters/${this.c.id}/battle`).catch(() => ({ battle: null }));
      if (r.battle && !this.inBattle && !this.closed) this.openBattle({ ...r.battle, resumed: true });
    }
    this.draw(); this.renderPanel();
  }
  openBattle(b: BattleView) {
    if (this.inBattle) return; this.inBattle = true;
    const meId = b.combatants.find((x) => x.characterId === this.c.id)?.id;
    if (meId && b.pending?.includes(meId) && b.status === 'active') b = { ...b, waiting: true };
    this.panel.classList.add('hidden'); this.scene.setVisible(false, 'Hud'); document.getElementById('chat')?.classList.add('hidden');
    this.cameras.main.flash(180, 200, 160, 255);
    this.scene.launch('Battle', { battle: b, character: this.c, onEnd: (r: { status: string }) => this.afterBattle(r.status) });
    this.scene.bringToTop('Battle'); this.scene.setVisible(false); // Dungeon is registered after Battle, so it would draw over it
  }
  async afterBattle(status: string) {
    playBgm('dungeon');
    this.inBattle = false; this.scene.setVisible(true); this.scene.setVisible(true, 'Hud'); document.getElementById('chat')?.classList.remove('hidden');
    const fresh = (await api<CharacterDto[]>('GET', '/characters').catch(() => [])).find((x) => x.id === this.c.id);
    if (fresh) { this.c = fresh; this.game.events.emit('character', fresh); }
    if (status === 'defeat') return this.exitToWorld('パーティーは全滅しました…（街に戻されました）');
    this.panel.classList.remove('hidden'); await this.refresh();
    if (this.d?.status === 'cleared') this.msg('ダンジョン踏破！クリア報酬を受け取れます', '#ffe08a');
  }
  msg(t: string, color = '#fff4cc') { const el = this.panel.querySelector('.d-msg') as HTMLElement | null; if (el) { el.textContent = t; el.style.color = color; } }
  async act(path: string, okText?: (r: any) => string) {
    try {
      const r = await api('POST', `/characters/${this.c.id}/dungeon/${path}`);
      if (path === 'battle') { if (r?.combatants) this.openBattle(r); return; }
      await this.refresh(); if (okText) this.msg(okText(r), '#9af0a0');
      const fresh = (await api<CharacterDto[]>('GET', '/characters').catch(() => [])).find((x) => x.id === this.c.id);
      if (fresh) { this.c = fresh; this.game.events.emit('character', fresh); }
    } catch (e) { this.msg(errText(e), '#ff9a8a'); await this.refresh(); }
  }
  rewardText(r: any) { return `${r.gold}G${r.exp ? ` / ${r.exp}EXP` : ''}${(r.items ?? []).map((i: any) => ` / ${i.name}×${i.qty}`).join('')} を手に入れた！${r.levelUp ? ` Lv${r.levelUp.to}にアップ！` : ''}`; }
  async leave() {
    if (this.leaving) return; this.leaving = true;
    try { await api('POST', `/characters/${this.c.id}/dungeon/leave`); } catch (e) { this.leaving = false; return this.msg(errText(e), '#ff9a8a'); }
    this.exitToWorld('ダンジョンを出ました');
  }
  async exitToWorld(note: string) {
    if (this.closed) return; this.closed = true;
    const fresh = (await api<CharacterDto[]>('GET', '/characters').catch(() => [])).find((x) => x.id === this.c.id) ?? this.c;
    this.game.events.emit('character', fresh); (window as any).__astralNote = note;
    this.scene.stop('Battle'); this.scene.setVisible(true, 'Hud'); document.getElementById('chat')?.classList.remove('hidden');
    this.scene.start('World', { character: fresh, note });
  }
  renderPanel() {
    const d = this.d; if (!d || !this.panel) return;
    const lead = d.leader === this.c.id, done = d.status === 'cleared';
    const mm = d.members.filter((m) => !m.left).map((m) => `<div class="d-m ${m.online ? '' : 'off'}" data-id="${m.id}"><span>${m.id === d.leader ? '<span class="lead">★</span>' : ''}${esc(m.name)} Lv${m.level}</span>
      <span class="d-tag">${m.online ? (m.inBattle ? '戦闘中' : '') : '切断中'}</span><div class="hp"><i style="width:${Math.round((100 * m.hp) / m.maxHp)}%"></i></div></div>`).join('');
    const btn = (id: string, label: string, on: boolean, cls = '') => `<button id="${id}" class="${cls}" ${on ? '' : 'disabled'}>${label}</button>`;
    this.panel.innerHTML = `<h3>${esc(d.name)}</h3><div class="d-floor">${esc(d.floorName)}（${d.floor}/${d.floors}）${done ? ' — 踏破済み' : ''}</div>
      <div class="d-net">${this.netStatus === 'online' ? '● 接続中のメンバーと同期' : this.netStatus === 'reconnecting' ? '● 再接続中…' : '● 未接続'}</div>${mm}
      <div class="d-act">
        ${!d.gateCleared ? btn('d-battle', d.isBoss ? 'ボスに挑む' : '魔物と戦う', !d.battleId) : ''}
        ${d.hasChest ? btn('d-chest', d.chestOpened ? '宝箱（受け取り済み）' : '宝箱を開ける', d.gateCleared && !d.chestOpened) : ''}
        ${d.floor < d.floors ? btn('d-next', lead ? '次の階へ進む' : '次の階へ（リーダーのみ）', lead && d.gateCleared) : ''}
        ${d.isBoss ? btn('d-claim', d.clearClaimed ? 'クリア報酬（受け取り済み）' : 'クリア報酬を受け取る', done && !d.clearClaimed) : ''}
        ${btn('d-leave', 'ダンジョンを出る', true, 'ghost')}
      </div><div class="d-msg"></div>`;
    const on = (id: string, f: () => void) => { const b = this.panel.querySelector('#' + id) as HTMLButtonElement | null; if (b) b.onclick = f; };
    on('d-battle', () => this.act('battle')); on('d-chest', () => this.act('chest', (r) => '宝箱：' + this.rewardText(r)));
    on('d-next', () => this.act('next', () => '階段を下りた…')); on('d-claim', () => this.act('claim', (r) => 'クリア報酬：' + this.rewardText(r)));
    on('d-leave', () => this.leave());
  }
  /** chamber art (procedural stone room, torches, chest, stairs, enemies, party) */
  draw() {
    const d = this.d; if (!d) return; this.layer.removeAll(true);
    const W = this.scale.width, H = this.scale.height, cx = (W - 300) / 2, cy = H / 2, rw = Math.min(W - 360, 760), rh = Math.min(H - 250, 440);
    const g = this.add.graphics(); this.layer.add(g);
    const x0 = cx - rw / 2, y0 = cy - rh / 2;
    g.fillStyle(0x1a1622).fillRect(x0 - 24, y0 - 60, rw + 48, rh + 84);
    for (let y = 0; y < rh; y += 32) for (let x = 0; x < rw; x += 32) { const v = ((x * 7 + y * 13 + d.floor * 31) % 5) * 3; g.fillStyle(Phaser.Display.Color.GetColor(46 + v, 40 + v, 54 + v)).fillRect(x0 + x + 1, y0 + y + 1, 30, 30); }
    for (let x = 0; x < rw + 48; x += 40) { g.fillStyle(0x3a3346).fillRect(x0 - 24 + x, y0 - 60, 38, 26); g.fillStyle(0x2c2638).fillRect(x0 - 4 + x, y0 - 32, 38, 26); }
    for (const tx of [x0 + 40, x0 + rw - 40]) {
      g.fillStyle(0x5a4630).fillRect(tx - 3, y0 - 40, 6, 18);
      const f = this.add.ellipse(tx, y0 - 46, 14, 20, 0xffa040); const halo = this.add.circle(tx, y0 - 40, 70, 0xff9030, 0.12).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: [f, halo], scaleX: 0.85, scaleY: 1.15, alpha: { from: 1, to: 0.7 }, duration: 260 + Math.random() * 200, yoyo: true, repeat: -1 }); this.layer.add([halo, f]);
    }
    const t = (x: number, y: number, s: string, size = 13, color = '#e8dcff') => this.layer.add(this.add.text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, color, stroke: '#000', strokeThickness: 4 }).setOrigin(0.5));
    t(cx, y0 - 82, `${d.name} — ${d.floorName}`, 20, '#ffe8c0');
    if (d.isBoss) { g.fillStyle(0x4a3a5a).fillRect(cx - 110, y0 + 30, 220, 70); g.fillStyle(0x5c4a70).fillRect(cx - 90, y0 + 20, 180, 14); const rune = this.add.circle(cx, y0 + 70, 46, 0xa060ff, 0.18).setBlendMode(Phaser.BlendModes.ADD); this.tweens.add({ targets: rune, alpha: 0.05, duration: 900, yoyo: true, repeat: -1 }); this.layer.add(rune); }
    if (!d.gateCleared) d.enemies.forEach((m, i) => {
      const fb = this.textures.exists(`mon_${m}`) ? null : MON_FB[m], n = d.enemies.length, x = cx + (i - (n - 1) / 2) * 110, y = y0 + (d.isBoss ? 110 : 140);
      const s = this.add.image(x, y, fb?.tex ?? `mon_${m}`).setOrigin(0.5, 1).setScale(fb?.scale ?? 1.4); if (fb) s.setTint(fb.tint);
      this.tweens.add({ targets: s, y: y - 4, duration: 700 + i * 90, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }); this.layer.add(s);
    });
    else t(cx, y0 + 110, d.isBoss ? (d.status === 'cleared' ? '守護者は崩れ落ちた — 踏破！' : '') : '魔物は一掃された', 15, '#bfe6a0');
    if (d.hasChest) { const chx = x0 + 80, chy = y0 + rh - 120, o = d.chestOpened, lock = !d.gateCleared;
      g.fillStyle(0x6a4320).fillRect(chx - 24, chy - 18, 48, 30).fillStyle(0xc8a040).fillRect(chx - 24, chy - 6, 48, 4).fillRect(chx - 3, chy - 10, 6, 10);
      if (o) g.fillStyle(0x3a2410).fillRect(chx - 24, chy - 34, 48, 14); else g.fillStyle(0x7a5228).fillRect(chx - 24, chy - 26, 48, 10);
      t(chx, chy + 26, o ? '宝箱（空）' : lock ? '宝箱（封印中）' : '宝箱', 12, o ? '#888' : '#ffe08a'); }
    if (d.floor < d.floors) { const sx = x0 + rw - 80, sy = y0 + rh - 120;
      for (let i = 0; i < 5; i++) g.fillStyle(d.gateCleared ? 0x5a5068 - i * 0x0a0a0a : 0x2a2430).fillRect(sx - 30 + i * 4, sy - 20 + i * 8, 60 - i * 8, 7);
      t(sx, sy + 34, d.gateCleared ? '下り階段' : '階段（封印中）', 12, d.gateCleared ? '#cfe8ff' : '#777'); }
    const ms = d.members.filter((m) => !m.left);
    ms.forEach((m, i) => { const x = cx + 60 + (i - (ms.length - 1) / 2) * 70, y = y0 + rh - 24;
      this.layer.add(this.add.ellipse(x, y - 2, 40, 12, 0x000000, 0.4));
      const s = this.add.sprite(x, y, lookTexture(this, m.class, (m as any).look), 3).setOrigin(0.5, 1).setScale(1.3).setAlpha(m.online ? 1 : 0.4); this.layer.add(s); // back view (facing the room)
      t(x, y + 12, m.name + (m.online ? '' : '（切断中）'), 11, m.id === this.c.id ? '#ffe08a' : '#fff'); });
  }
}
