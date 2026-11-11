import { lookTexture } from '../art/look';
import Phaser from 'phaser';
import { Client, getStateCallbacks, type Room } from 'colyseus.js';
import { inputToVector, vectorToDirection, moveWithCollision, PLAYER_SPEED, type Direction, type MapData, type Vec2 } from '@astral/shared';
import { api, errText, session, type CharacterDto } from '../api';
import { wsEndpoint } from '../net';
import { chatBus } from '../chat';
import { playBgm } from '../audio';
import { battlePort } from '../dungeonBus';
import { socialBus } from '../social';
import { touchState } from '../touch';
import { MAPS } from '../maps';
import type { BattleView } from './BattleScene';
const FONT = '"DotGothic16", sans-serif';
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const FACE4: Record<Direction, string> = { s: 'down', n: 'up', w: 'left', nw: 'left', sw: 'left', e: 'right', ne: 'right', se: 'right' };
const SHEET: Record<Direction, number> = { s: 0, n: 3, w: 1, nw: 1, sw: 1, e: 2, ne: 2, se: 2 };
const TYPE_ORDER = [1, 3, 2, 4];
const hash = (x: number, y: number) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export type DungeonView = { id: string; dungeonId: string; name: string; status: string; floor: number; floors: number; floorName: string; leader: string; expiresAt: string;
  isBoss: boolean; enemies: string[]; gateCleared: boolean; hasChest: boolean; chestOpened: boolean; clearClaimed: boolean; battleId: string | null;
  mapId?: string; backdrop?: string; pos?: Vec2;
  members: { id: string; name: string; class: string; level: number; hp: number; maxHp: number; mp: number; maxMp: number; left: boolean; online: boolean; inBattle: boolean; x?: number; y?: number; look?: unknown }[] };
/**
 * Instance dungeon: walkable multi-room floor map (server-validated movement) plus the side HUD for party/actions.
 * Colyseus 'dungeon' room is presence, chat, and movement; REST remains authoritative for battles/rewards.
 */
export class DungeonScene extends Phaser.Scene {
  c!: CharacterDto; d: DungeonView | null = null; room?: Room; client = new Client(wsEndpoint()); closed = false;
  panel!: HTMLDivElement; layer!: Phaser.GameObjects.Container; inBattle = false; leaving = false; netStatus = 'connecting';
  map: MapData | null = null; pos: Vec2 = { x: 0, y: 0 }; player?: Phaser.GameObjects.Sprite; nameTag?: Phaser.GameObjects.Text;
  prompt?: Phaser.GameObjects.Text; keys!: any; facing: Direction = 's'; walkT = 0; syncT = 0; netMoving = false;
  remotes = new Map<string, { spr: Phaser.GameObjects.Sprite; tag: Phaser.GameObjects.Text; tx: number; ty: number; facing: string; moving: boolean; t: number }>();
  lastMapId = '';
  constructor() { super('Dungeon'); }
  init(data: { character: CharacterDto }) { this.c = data.character; this.d = null; this.closed = false; this.inBattle = false; this.leaving = false; this.map = null; this.lastMapId = ''; this.remotes.clear(); }
  async create() {
    this.cameras.main.setBackgroundColor('#07050c'); this.cameras.main.fadeIn(300); playBgm('dungeon');
    this.layer = this.add.container(0, 0);
    this.panel = document.createElement('div'); this.panel.id = 'dungeon'; document.getElementById('ui')!.appendChild(this.panel);
    const kb = this.input.keyboard!;
    this.keys = { up: kb.addKey('UP'), down: kb.addKey('DOWN'), left: kb.addKey('LEFT'), right: kb.addKey('RIGHT'),
      w: kb.addKey('W'), a: kb.addKey('A'), s: kb.addKey('S'), d: kb.addKey('D'), e: kb.addKey('E') };
    this.keys.e.on('down', () => { if (!this.inBattle && !this.closed) this.interact(); });
    this.events.once('shutdown', () => { this.closed = true; this.panel.remove(); this.room?.leave(true).catch?.(() => {}); this.room = undefined; if (chatBus.send) chatBus.send = null; this.scale.off('resize', this.onResize, this); this.clearRemotes(); });
    this.scale.on('resize', this.onResize, this);
    await this.refresh();
    if (!this.d) return this.exitToWorld('ダンジョンは終了しています');
    this.connect();
  }
  onResize() { /* camera bounds come from the floor map */ }
  async connect() {
    if (this.closed || !this.d) return;
    try { this.attach(await this.client.joinOrCreate('dungeon', { token: session.token, characterId: this.c.id, instanceId: this.d.id })); }
    catch { this.netStatus = 'offline'; this.renderPanel(); if (!this.closed) this.time.delayedCall(2000, () => this.connect()); }
  }
  attach(room: Room) {
    if (this.closed) { room.leave(true); return; }
    this.room = room; this.netStatus = 'online'; this.renderPanel();
    const sendReady = (v: boolean) => { if (this.room) this.room.send(v ? 'battle_ready' : 'battle_idle'); };
    battlePort.ready = sendReady;
    if (this.inBattle) sendReady(true);
    this.events.once('shutdown', () => { if (battlePort.ready === sendReady) battlePort.ready = () => {}; });

    const $ = getStateCallbacks(room) as any;
    $(room.state).players.onAdd((p: any, key: string) => {
      if (p.id === this.c.id) return;
      const r = this.remotes.get(key) ?? this.spawnRemote(key, p); r.tx = p.x; r.ty = p.y;
      $(p).onChange(() => { r.tx = p.x; r.ty = p.y; r.facing = p.facing; r.moving = p.moving; r.tag.setText(p.name); });
    });
    $(room.state).players.onRemove((_p: any, key: string) => { const r = this.remotes.get(key); r?.spr.destroy(); r?.tag.destroy(); this.remotes.delete(key); });
    room.onMessage('correct', (m: any) => { if (m?.pos) this.pos = { x: m.pos.x, y: m.pos.y }; });
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
  spawnRemote(key: string, p: any) {
    const spr = this.add.sprite(p.x, p.y, lookTexture(this, p.cls, p.look), 0).setOrigin(0.5, 1).setDepth(p.y);
    const tag = this.add.text(p.x, p.y - 62, p.name, { fontFamily: FONT, fontSize: '12px', color: '#bfe6ff', backgroundColor: '#0c1020cc', padding: { x: 4, y: 1 } }).setOrigin(0.5, 1).setDepth(p.y + 0.2);
    const r = { spr, tag, tx: p.x, ty: p.y, facing: p.facing ?? 'down', moving: !!p.moving, t: 0 }; this.remotes.set(key, r); return r;
  }
  clearRemotes() { for (const r of this.remotes.values()) { r.spr.destroy(); r.tag.destroy(); } this.remotes.clear(); }
  async onDungeon(m: any) {
    if (m?.type === 'ended') { if (!this.inBattle) return this.exitToWorld(m.reason === 'expired' ? '制限時間切れでダンジョンから戻されました' : m.reason === 'failed' ? 'パーティーは全滅しました…' : 'ダンジョンを出ました'); return; }
    if (m?.type === 'battle' && !this.inBattle) { await this.refresh(); return; }
    await this.refresh();
  }
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
      else if (!r.battle && !this.closed) this.time.delayedCall(400, () => { if (!this.inBattle && !this.closed) this.refresh(); });
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
      <div class="d-hint">マップを歩いて魔物・宝箱・階段に近づき E でも操作できます</div>
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
  interact() {
    const t = this.nearest(); if (!t) return;
    if (t.kind === 'encounter') return this.act('battle');
    if (t.kind === 'chest') return this.act('chest', (r) => '宝箱：' + this.rewardText(r));
    if (t.kind === 'stairs') return this.act('next', () => '階段を下りた…');
  }
  nearest(): { kind: string; x: number; y: number } | null {
    if (!this.map) return null;
    let best: { kind: string; x: number; y: number; d: number } | null = null;
    for (const o of this.map.objects) {
      if (o.type !== 'encounter' && o.type !== 'chest' && o.type !== 'stairs') continue;
      const d = Math.hypot(this.pos.x - o.x, this.pos.y - o.y);
      if (d <= 64 && (!best || d < best.d)) best = { kind: o.type, x: o.x, y: o.y - 40, d };
    }
    return best;
  }
  /** Walkable floor: tiled ground, markers, own sprite. Rebuilds when the floor map changes. */
  draw() {
    const d = this.d; if (!d) return;
    const map = d.mapId ? MAPS[d.mapId] : undefined;
    if (!map) return;
    const floorChanged = this.lastMapId !== map.id;
    if (floorChanged) {
      this.layer.removeAll(true); this.map = map; this.lastMapId = map.id;
      this.buildGround(map);
      this.pos = { x: d.pos?.x ?? map.spawn.x, y: d.pos?.y ?? map.spawn.y };
      for (const o of map.objects) {
        if (o.type === 'deco' && o.kind) {
          const img = this.add.image(o.x, o.y, this.textures.exists(`sp_${o.kind}`) ? `sp_${o.kind}` : 'sp_rocks').setOrigin(0.5, 1).setDepth(o.y);
          this.layer.add(img);
        }
        if (o.type === 'encounter' || o.type === 'chest' || o.type === 'stairs') {
          const label = o.type === 'encounter' ? (d.isBoss ? 'ボス' : '魔物') : o.type === 'chest' ? '宝箱' : '階段';
          const color = o.type === 'encounter' ? (d.isBoss ? '#ffb080' : '#f0a0a0') : o.type === 'chest' ? '#ffe08a' : '#cfe8ff';
          const mark = this.add.circle(o.x, o.y - 10, 14, o.type === 'encounter' ? 0xc04040 : o.type === 'chest' ? 0xc8a040 : 0x6080c0, 0.85).setDepth(o.y);
          const txt = this.add.text(o.x, o.y + 8, label, { fontFamily: FONT, fontSize: '12px', color, stroke: '#000', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(o.y + 0.2);
          mark.setName('mk_' + o.id); txt.setName('lb_' + o.id);
          this.layer.add([mark, txt]);
        }
      }
      const title = this.add.text(map.width * 16, 18, `${d.name} — ${d.floorName}`, { fontFamily: FONT, fontSize: '16px', color: '#ffe8c0', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(10000);
      this.layer.add(title);
      if (this.player) { this.player.destroy(); this.nameTag?.destroy(); this.prompt?.destroy(); }
      this.player = this.add.sprite(this.pos.x, this.pos.y, lookTexture(this, this.c.class, this.c.appearance), 3).setOrigin(0.5, 1);
      this.nameTag = this.add.text(this.pos.x, this.pos.y - 62, this.c.name, { fontFamily: FONT, fontSize: '12px', color: '#ffe08a', backgroundColor: '#0c1020cc', padding: { x: 4, y: 1 } }).setOrigin(0.5, 1);
      this.prompt = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '13px', color: '#fff4cc', backgroundColor: '#0c1020cc', padding: { x: 6, y: 2 } }).setOrigin(0.5, 1).setVisible(false).setDepth(1000);
      this.cameras.main.setBounds(0, 0, map.width * 32, map.height * 32);
      this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
    }
    this.updateMarkers();
  }
  updateMarkers() {
    const d = this.d, map = this.map; if (!d || !map) return;
    for (const o of map.objects) {
      const mk = this.children.getByName('mk_' + o.id) as Phaser.GameObjects.Arc | undefined;
      const lb = this.children.getByName('lb_' + o.id) as Phaser.GameObjects.Text | undefined;
      if (!mk) continue;
      if (o.type === 'encounter') { mk.setVisible(!d.gateCleared); lb?.setVisible(!d.gateCleared); }
      if (o.type === 'chest') { mk.setAlpha(d.chestOpened ? 0.4 : d.gateCleared ? 1 : 0.5); lb?.setText(d.chestOpened ? '宝箱（空）' : d.gateCleared ? '宝箱' : '宝箱（封印）'); }
      if (o.type === 'stairs') { mk.setAlpha(d.gateCleared ? 1 : 0.4); lb?.setText(d.gateCleared ? '下り階段' : '階段（封印）'); }
    }
    if (d.gateCleared && d.isBoss && d.status === 'cleared') {
      /* markers already hidden */
    }
  }
  buildGround(map: MapData) {
    const mw = map.width, mh = map.height, W = mw * 32, H = mh * 32;
    const gd = map.layers.find((l) => l.name === 'ground')!.data;
    const src = this.textures.get('groundtex').getSourceImage() as HTMLImageElement;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#0c0a12'; ctx.fillRect(0, 0, W, H);
    for (const t of TYPE_ORDER) {
      const ts = t === 2 ? 128 : 256;
      const tile = document.createElement('canvas'); tile.width = ts; tile.height = ts; const tc = tile.getContext('2d')!;
      tc.imageSmoothingEnabled = ts !== 256; tc.drawImage(src, (t - 1) * 256, 0, 256, 256, 0, 0, ts, ts);
      const layer = document.createElement('canvas'); layer.width = W; layer.height = H; const lc = layer.getContext('2d')!;
      lc.fillStyle = lc.createPattern(tile, 'repeat')!; lc.fillRect(0, 0, W, H);
      const mask = document.createElement('canvas'); mask.width = W; mask.height = H; const mc = mask.getContext('2d')!;
      const id = mc.createImageData(W, H), data = id.data;
      for (let ty = 0; ty < mh; ty++) for (let tx = 0; tx < mw; tx++) if (gd[ty * mw + tx] === t) {
        for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) data[(((ty * 32 + y) * W) + tx * 32 + x) * 4 + 3] = 255;
      }
      mc.putImageData(id, 0, 0);
      lc.globalCompositeOperation = 'destination-in'; lc.drawImage(mask, 0, 0);
      ctx.drawImage(layer, 0, 0);
    }
    const key = 'dgground_' + map.id;
    if (this.textures.exists(key)) this.textures.remove(key);
    this.textures.addCanvas(key, cv);
    this.layer.add(this.add.image(0, 0, key).setOrigin(0, 0).setDepth(-10));
  }
  update(_t: number, dtMs: number) {
    if (this.inBattle || this.closed || !this.map || !this.player) return;
    const k = Math.min(1, dtMs / 90);
    for (const r of this.remotes.values()) {
      const x = r.spr.x + (r.tx - r.spr.x) * k, y = r.spr.y + (r.ty - r.spr.y) * k; r.t += dtMs;
      const moving = r.moving || Math.hypot(r.tx - x, r.ty - y) > 1, base = r.facing === 'up' ? 3 : r.facing === 'left' ? 1 : r.facing === 'right' ? 2 : 0;
      const step = Math.floor(r.t / 150) % 4;
      r.spr.setPosition(x, y).setFrame(moving ? (step % 2 ? base : 4 + base * 2 + (step >> 1)) : base).setDepth(y);
      r.tag.setPosition(Math.round(x), Math.round(y) - 62).setDepth(y + 0.2);
    }
    const K = this.keys, T = touchState;
    const v = inputToVector({ up: K.up.isDown || K.w.isDown || T.up, down: K.down.isDown || K.s.isDown || T.down, left: K.left.isDown || K.a.isDown || T.left, right: K.right.isDown || K.d.isDown || T.right });
    const dt = Math.min(dtMs, 100) / 1000;
    this.pos = moveWithCollision(this.map, this.pos, { x: v.x * PLAYER_SPEED * dt, y: v.y * PLAYER_SPEED * dt });
    const dir = vectorToDirection(v); if (dir) this.facing = dir;
    this.walkT = dir ? this.walkT + dtMs : 0;
    const base = SHEET[this.facing], step = Math.floor(this.walkT / 150) % 4;
    const frame = dir ? (step % 2 ? base : 4 + base * 2 + (step >> 1)) : base;
    this.player.setPosition(Math.round(this.pos.x), Math.round(this.pos.y)).setFrame(frame).setDepth(this.pos.y);
    this.nameTag?.setPosition(Math.round(this.pos.x), Math.round(this.pos.y) - 62).setDepth(this.pos.y + 0.2);
    this.syncT += dtMs;
    if (this.syncT >= 120 || (!dir && this.syncT > 120)) {
      this.syncT = 0;
      this.room?.send('move', { x: Math.round(this.pos.x), y: Math.round(this.pos.y), facing: FACE4[this.facing], moving: !!dir });
    }
    if (!dir && this.netMoving) { this.netMoving = false; this.room?.send('move', { x: Math.round(this.pos.x), y: Math.round(this.pos.y), facing: FACE4[this.facing], moving: false }); }
    if (dir) this.netMoving = true;
    const t = this.nearest();
    if (t && this.prompt) this.prompt.setText('E: ' + (t.kind === 'encounter' ? (this.d?.isBoss ? 'ボスに挑む' : '戦う') : t.kind === 'chest' ? '宝箱を開ける' : '階段を進む')).setPosition(t.x, t.y).setVisible(true).setDepth(1000);
    else this.prompt?.setVisible(false);
  }
}
