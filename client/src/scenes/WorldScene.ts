import Phaser from 'phaser';
import { inputToVector, vectorToDirection, moveWithCollision, PLAYER_SPEED, type Direction, type MapData, type Vec2 } from '@astral/shared';
import asteria from '../../../assets/maps/asteria.json';
import meadow from '../../../assets/maps/green_meadow.json';
import { api, errText, session, type CharacterDto } from '../api';
import type { BattleView } from './BattleScene';
import { openInventory, closePanel, panelOpen, newRequestId } from '../panels';
import { openDialog, openQuests } from '../npcpanels';
import { Presence } from '../net';
import { toggleSocial } from '../social';
const FACE4: Record<Direction, string> = { s: 'down', n: 'up', w: 'left', nw: 'left', sw: 'left', e: 'right', ne: 'right', se: 'right' };
const FONT = '"DotGothic16", sans-serif';
const MAPS: Record<string, MapData> = { asteria: asteria as unknown as MapData, green_meadow: meadow as unknown as MapData };
interface Symbol { s: Phaser.GameObjects.Image; sh: Phaser.GameObjects.Ellipse; id: string; pos: Vec2; v: Vec2; t: number }
/** char sheet frames: 0 front, 1 left-facing, 2 right-facing, 3 back (idle); 4+2*dir..5+2*dir = walk A/B (scripts/gen-walk-frames.py) */
const SHEET_FRAME: Record<Direction, number> = { s: 0, n: 3, w: 1, nw: 1, sw: 1, e: 2, ne: 2, se: 2 };
const POS_SYNC_MS = 400;
const TYPE_ORDER = [1, 3, 2, 4]; // grass base, then dirt, cobble, water painted on top with soft organic edges
const hash = (x: number, y: number) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/**
 * 3/4 top-down (oblique) view: ground tiles flat, tall objects anchored at their footprint bottom.
 * Everything that stands is Y-sorted by its ground contact Y (depth = y), so the player is hidden
 * behind roofs/canopies when standing north of them and drawn in front when south.
 */
export class WorldScene extends Phaser.Scene {
  map!: MapData; pos!: Vec2; player!: Phaser.GameObjects.Sprite; nameTag!: Phaser.GameObjects.Text;
  keys!: Record<'up'|'down'|'left'|'right'|'w'|'a'|'s'|'d', Phaser.Input.Keyboard.Key>;
  facing: Direction = 's'; walkT = 0; props: Phaser.GameObjects.Image[] = []; character!: CharacterDto;
  lastSent = { x: 0, y: 0 }; syncT = 0; syncing = false; portalBusy = false; prompt!: Phaser.GameObjects.Text; nodes: { id: string; x: number; y: number; img: Phaser.GameObjects.Image; type: string }[] = [];
  keyE!: Phaser.Input.Keyboard.Key; keyI!: Phaser.Input.Keyboard.Key;
  battleZone?: string; symbols: Symbol[] = []; inBattle = false; cooldownUntil = 0; spawnRect?: { x: number; y: number; w: number; h: number; monsters: string[]; zone: string };
  netMoving = false; presence?: Presence; netText!: Phaser.GameObjects.Text;
  /** BUG-014: the main camera is zoomed 1.5x, so scrollFactor(0) HUD objects are scaled about the screen centre. Map a screen px to that space. */
  hud<T extends Phaser.GameObjects.Text>(o: T, sx: number, sy: number): T {
    const z = this.cameras.main.zoom, cx = this.scale.width / 2, cy = this.scale.height / 2;
    return o.setScale(1 / z).setPosition(cx + (sx - cx) / z, cy + (sy - cy) / z);
  }
  constructor() { super('World'); }
  create(data: { character: CharacterDto }) {
    this.character = data.character;
    // PHASE 4: map + position come from the server (characters.map_id/pos_x/pos_y); client only predicts movement
    this.map = MAPS[this.character.map_id] ?? MAPS.asteria; this.nodes = []; this.portalBusy = false;
    this.symbols = []; this.inBattle = false; this.cooldownUntil = this.time.now + 1500; this.spawnRect = undefined;
    this.buildGround();
    this.props = [];
    for (const o of this.map.objects) {
      if (o.type === 'deco' && o.kind) {
        const tex = `sp_${o.kind}`;
        if (o.kind === 'fence_h' && (o.tx ?? 0) % 2 === 0) continue; // 64px sprite spans two footprint tiles
        const x = o.kind === 'fence_h' ? o.x + 16 : o.x;
        const img = this.add.image(x, o.y + (o.kind.startsWith('fence') ? 6 : 0), tex).setOrigin(0.5, 1).setDepth(o.y);
        img.setData('kind', o.kind); this.props.push(img);
        if (o.label) this.add.text(o.x, o.y - img.height - 2, o.label, { fontFamily: FONT, fontSize: '12px', color: '#ffe9b0', backgroundColor: '#2a1a0cdd', padding: { x: 5, y: 2 } }).setOrigin(0.5, 0).setDepth(o.y + 0.5);
      } else if (o.type === 'gather' && o.kind) {
        const img = this.add.image(o.x, o.y, `sp_${o.kind}`).setOrigin(0.5, 1).setDepth(o.y);
        this.nodes.push({ id: o.id, x: o.x, y: o.y, img, type: String(o.props?.gatherType) });
      } else if (o.type === 'npc') {
        const sheet = String(o.props?.sheet ?? 'priest');
        this.add.sprite(o.x, o.y, `ch_${sheet}`, sheet.startsWith('npc_') ? undefined : 0).setOrigin(0.5, 1).setDepth(o.y);
        this.add.text(o.x, o.y - 62, String(o.props?.name ?? o.id), { fontFamily: FONT, fontSize: '12px', color: '#ffe08a', backgroundColor: '#0c1020cc', padding: { x: 4, y: 1 } }).setOrigin(0.5, 1).setDepth(1e6);
      }
    }
    const c = this.character;
    this.pos = c.map_id === this.map.id ? { x: c.pos_x, y: c.pos_y } : { ...this.map.spawn };
    this.lastSent = { ...this.pos }; this.syncT = 0;
    // NOTE: appearance (hair/skin/body) is not yet reflected by the generated class sheets (KNOWN LIMITATION, see BUG-007)
    this.player = this.add.sprite(this.pos.x, this.pos.y, `ch_${c.class}`, 0).setOrigin(0.5, 1);
    this.nameTag = this.add.text(0, 0, c.name, { fontFamily: FONT, fontSize: '12px', color: '#fff', backgroundColor: '#0c1020cc', padding: { x: 4, y: 1 } }).setOrigin(0.5, 1).setDepth(1e6);
    this.cameras.main.setBounds(0, 0, this.map.width * 32, this.map.height * 32).startFollow(this.player, true, 0.15, 0.15).setRoundPixels(true).setZoom(1.5); // close 3/4 framing like the art target
    // PHASE 6: shared map room (other players + server-validated movement)
    this.netText = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '12px', color: '#cfe8ff', backgroundColor: '#0c1020cc', padding: { x: 6, y: 2 } }).setScrollFactor(0).setDepth(1e7);
    const placeNet = () => this.hud(this.netText, this.scale.width - this.netText.width - 110, 12);
    const label: Record<string, string> = { connecting: '接続中…', online: 'オンライン', reconnecting: '再接続中…', offline: 'オフライン' };
    this.presence = new Presence(this, c.id, this.map.id, (pos) => { this.pos = { x: pos.x, y: pos.y }; this.lastSent = { ...this.pos }; },
      (st) => { this.netText.setText(`● ${label[st] ?? st}`).setColor(st === 'online' ? '#9af0a0' : '#ffd27a'); placeNet(); });
    this.presence.connect();
    this.events.once('shutdown', () => { this.presence?.close(); this.presence = undefined; });
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = this.input.keyboard!.addKeys({ up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT, w: K.W, a: K.A, s: K.S, d: K.D }) as any;
    this.input.keyboard!.addKey(K.O).on('down', () => toggleSocial());
    this.keyE = this.input.keyboard!.addKey(K.E); this.keyI = this.input.keyboard!.addKey(K.I);
    this.input.keyboard!.addKey(K.L).on('down', () => { if (panelOpen()) closePanel(); else if (!this.inBattle) openQuests(null, this.character, (c) => this.onCharacter(c)); });
    this.keyE.on('down', () => this.interact()); this.keyI.on('down', () => { if (panelOpen()) closePanel(); else if (!this.inBattle) openInventory(this.character, (c) => this.onCharacter(c)); });
    this.events.once('shutdown', () => { closePanel(); this.keyE.removeAllListeners(); this.keyI.removeAllListeners(); });
    this.prompt = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '12px', color: '#fff4cc', backgroundColor: '#3a2a14ee', padding: { x: 5, y: 2 } }).setOrigin(0.5, 1).setDepth(1e6 + 1).setVisible(false);
    const info = this.add.text(0, 0, `${this.map.name}  WASD/矢印:移動  E:調べる/採集  I:持ち物`, { fontFamily: FONT, fontSize: '13px', color: '#fff', backgroundColor: '#000a', padding: { x: 6, y: 3 } }).setScrollFactor(0).setDepth(1e7);
    const place = () => this.hud(info, Math.round(this.scale.width / 2 - info.width / 2), this.scale.height - info.height - 8);
    place(); this.scale.on('resize', place);
    this.events.once('shutdown', () => this.scale.off('resize', place));
    const sp = this.map.objects.find((o) => o.type === 'spawn');
    if (sp) { this.spawnRect = { x: sp.tx! * 32, y: sp.ty! * 32, w: sp.fw! * 32, h: sp.fh! * 32, monsters: sp.props!.monsters as string[], zone: String(sp.props!.zone) };
      for (let i = 0; i < Number(sp.props!.count ?? 6); i++) this.spawnSymbol(); }
    // disconnect safety: an unfinished battle on the server is resumed as soon as the world loads
    api<{ battle: BattleView | null }>('GET', `/characters/${c.id}/battle`).then((r) => { if (r.battle && this.scene.isActive()) this.openBattle({ ...r.battle, resumed: true }); }).catch(() => {});
  }
  /** Field symbol (on-screen monster). Wander is client-side cosmetics; the encounter itself is created by the server. */
  spawnSymbol() {
    const R = this.spawnRect!; let pos: Vec2 = { x: 0, y: 0 };
    for (let k = 0; k < 60; k++) { pos = { x: R.x + Math.random() * R.w, y: R.y + Math.random() * R.h };
      const m = moveWithCollision(this.map, pos, { x: 0.01, y: 0 }); if (Math.abs(m.x - pos.x) < 1 && Math.hypot(pos.x - this.pos.x, pos.y - this.pos.y) > 220) break; }
    const id = R.monsters[Math.floor(Math.random() * R.monsters.length)];
    const sh = this.add.ellipse(pos.x, pos.y - 2, 30, 9, 0x0a0e06, 0.3).setDepth(pos.y - 1);
    const s = this.add.image(pos.x, pos.y, `mon_${id}`).setOrigin(0.5, 1).setScale(0.62).setDepth(pos.y);
    this.symbols.push({ s, sh, id, pos, v: { x: 0, y: 0 }, t: 0 });
  }
  updateSymbols(dtMs: number) {
    const R = this.spawnRect!;
    for (const m of this.symbols) {
      m.t -= dtMs;
      if (m.t <= 0) { const a = Math.random() * Math.PI * 2, go = Math.random() < 0.6; m.v = go ? { x: Math.cos(a) * 38, y: Math.sin(a) * 38 } : { x: 0, y: 0 }; m.t = 900 + Math.random() * 1800; }
      const n = moveWithCollision(this.map, m.pos, { x: m.v.x * dtMs / 1000, y: m.v.y * dtMs / 1000 });
      if (n.x < R.x || n.y < R.y || n.x > R.x + R.w || n.y > R.y + R.h) m.t = 0; else m.pos = n;
      const hop = m.v.x || m.v.y ? Math.abs(Math.sin(this.time.now / 140)) * 3 : 0;
      m.s.setPosition(Math.round(m.pos.x), Math.round(m.pos.y - hop)).setDepth(m.pos.y).setFlipX(m.v.x > 0);
      m.sh.setPosition(m.pos.x, m.pos.y - 2).setDepth(m.pos.y - 1);
      if (!this.inBattle && this.time.now > this.cooldownUntil && Math.abs(m.pos.x - this.pos.x) < 24 && Math.abs(m.pos.y - this.pos.y) < 18) this.encounter(m);
    }
  }
  async encounter(m: Symbol) {
    this.inBattle = true;
    try {
      const b = await api<BattleView>('POST', '/battles', { characterId: this.character.id, zone: this.spawnRect!.zone, lead: m.id });
      m.s.destroy(); m.sh.destroy(); this.symbols = this.symbols.filter((x) => x !== m);
      this.openBattle(b);
    } catch (e) { this.inBattle = false; this.cooldownUntil = this.time.now + 2000; this.toast(errText(e)); }
  }
  openBattle(b: BattleView) {
    this.inBattle = true; this.battleZone = b.zone;
    this.cameras.main.flash(180, 255, 255, 255);
    this.time.delayedCall(200, () => {
      this.scene.setVisible(false, 'Hud'); document.getElementById('chat')?.classList.add('hidden');
      this.scene.launch('Battle', { battle: b, character: this.character, onEnd: (r: { status: string }) => this.afterBattle(r.status) });
    });
  }
  async afterBattle(status: string) {
    document.getElementById('chat')?.classList.remove('hidden');
    const fresh = (await api<CharacterDto[]>('GET', '/characters').catch(() => [])).find((x) => x.id === this.character.id);
    if (fresh) { this.character = fresh; this.game.events.emit('character', fresh); }
    this.scene.setVisible(true, 'Hud');
    // defeat: the server already moved the character to town (TD-011); any map mismatch -> follow the server
    if (this.character.map_id !== this.map.id) return this.scene.restart({ character: this.character });
    this.inBattle = false; this.cooldownUntil = this.time.now + 2500;
    if (this.spawnRect && this.symbols.length < 7) this.time.delayedCall(4000, () => this.scene.isActive() && this.spawnSymbol());
  }
  toast(msg: string, bg = '#a02020dd') {
    const t = this.add.text(0, 0, msg, { fontFamily: FONT, fontSize: '14px', color: '#fff', backgroundColor: bg, padding: { x: 8, y: 4 } }).setOrigin(0.5).setScrollFactor(0).setDepth(1e7); this.hud(t, this.scale.width / 2, 80);
    this.time.delayedCall(2500, () => t.destroy());
  }
  checkPortal() {
    const tx = Math.floor(this.pos.x / 32), ty = Math.floor((this.pos.y - 1) / 32);
    const p = this.map.objects.find((o) => o.type === 'portal' && o.fw && tx >= o.tx! && tx < o.tx! + o.fw && ty >= o.ty! && ty < o.ty! + o.fh!);
    if (!p || !MAPS[String(p.props?.to)] || this.portalBusy) return;
    // server decides the map change: flush our position, then ask to use the portal
    this.portalBusy = true; this.inBattle = true;
    (async () => {
      try {
        await this.syncPosition(true);
        const r = await api<{ pos: { mapId: string; x: number; y: number } }>('POST', `/characters/${this.character.id}/portal`, { portalId: p.id });
        this.character = { ...this.character, map_id: r.pos.mapId, pos_x: r.pos.x, pos_y: r.pos.y };
        this.cameras.main.fadeOut(250);
        this.time.delayedCall(260, () => this.scene.restart({ character: this.character }));
      } catch (e) {
        this.toast(errText(e)); this.inBattle = false;
        this.pos = { x: this.pos.x - 24, y: this.pos.y }; // step back off the portal
        this.time.delayedCall(800, () => { this.portalBusy = false; });
      }
    })();
  }
  /** Send the predicted position; the server validates (map/collision/speed) and may snap us back. */
  async syncPosition(force = false) {
    if (this.syncing && !force) return;
    if (!force && Math.hypot(this.pos.x - this.lastSent.x, this.pos.y - this.lastSent.y) < 2) return;
    const sent = { x: Math.round(this.pos.x), y: Math.round(this.pos.y) };
    if (!force && this.presence?.sendMove(sent.x, sent.y, FACE4[this.facing], this.walkT > 0)) { this.lastSent = sent; this.character.pos_x = sent.x; this.character.pos_y = sent.y; return; }
    this.syncing = true;
    try {
      const r = await fetch('/api' + `/characters/${this.character.id}/position`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ mapId: this.map.id, ...sent }) });
      const j = await r.json().catch(() => null);
      if (j?.ok) { this.lastSent = sent; this.character.pos_x = sent.x; this.character.pos_y = sent.y; }
      else if (j?.pos) {
        if (j.pos.mapId !== this.map.id) { this.character = { ...this.character, map_id: j.pos.mapId, pos_x: j.pos.x, pos_y: j.pos.y }; this.scene.restart({ character: this.character }); return; }
        this.pos = { x: j.pos.x, y: j.pos.y }; this.lastSent = { ...this.pos }; // server correction
      }
    } catch { /* offline: retry on next tick */ } finally { this.syncing = false; }
  }
  onCharacter(c: CharacterDto) { this.character = { ...this.character, ...c }; this.game.events.emit('character', this.character); }
  nearest() {
    const npc = this.map.objects.filter((o) => o.type === 'npc').map((o) => ({ o, d: Math.hypot(o.x - this.pos.x, o.y - this.pos.y) })).sort((a, b) => a.d - b.d)[0];
    const node = this.nodes.map((n) => ({ n, d: Math.hypot(n.x - this.pos.x, n.y - 16 - this.pos.y) })).sort((a, b) => a.d - b.d)[0];
    if (node && node.d < 52) return { kind: 'node' as const, node: node.n, x: node.n.x, y: node.n.y - 52 };
    if (npc && npc.d < 72) return { kind: 'npc' as const, npc: npc.o, x: npc.o.x, y: npc.o.y - 78 };
    return null;
  }
  async interact() {
    if (this.inBattle || panelOpen()) return;
    const t = this.nearest(); if (!t) return;
    await this.syncPosition(true); // gather/craft distance is checked against the server position
    if (t.kind === 'npc') {
      openDialog(t.npc.id, this.character, (c) => this.onCharacter(c));
      return;
    }
    try {
      const r = await api('POST', `/characters/${this.character.id}/gather`, { nodeId: t.node.id, requestId: newRequestId() });
      this.tweens.add({ targets: t.node.img, y: t.node.y - 4, yoyo: true, duration: 90, repeat: 2 });
      this.toast(`${r.item.name} ×${r.item.qty} を手に入れた！${r.levelUp ? `（採集Lv${r.level}にアップ）` : ''}`, '#2a6a3add');
      t.node.img.setAlpha(0.45); this.time.delayedCall(r.respawnSec * 1000, () => t.node.img.active && t.node.img.setAlpha(1));
    } catch (e) { this.toast(errText(e)); }
  }
  /** Composite the ground into one canvas: seamless 256px textures per type, masks upscaled bilinearly from the
   * tile grid and thresholded with 2px-block noise -> rounded, ragged borders instead of hard 32px squares. */
  buildGround() {
    const mw = this.map.width, mh = this.map.height, W = mw * 32, H = mh * 32;
    const gd = this.map.layers.find((l) => l.name === 'ground')!.data;
    const src = this.textures.get('groundtex').getSourceImage() as HTMLImageElement;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d')!;
    for (const t of TYPE_ORDER) {
      const ts = t === 2 ? 128 : 256; // cobble at half scale: stones ~12px like hand-placed pixel art
      const tile = document.createElement('canvas'); tile.width = ts; tile.height = ts; const tc = tile.getContext('2d')!;
      tc.imageSmoothingEnabled = ts !== 256; tc.drawImage(src, (t - 1) * 256, 0, 256, 256, 0, 0, ts, ts);
      const layer = document.createElement('canvas'); layer.width = W; layer.height = H; const lc = layer.getContext('2d')!;
      lc.fillStyle = lc.createPattern(tile, 'repeat')!; lc.fillRect(0, 0, W, H);
      if (t !== 1) {
        const small = document.createElement('canvas'); small.width = mw + 2; small.height = mh + 2; const sc = small.getContext('2d')!;
        const id = sc.createImageData(mw + 2, mh + 2);
        for (let y = -1; y <= mh; y++) for (let x = -1; x <= mw; x++) {
          const cx = Math.min(mw - 1, Math.max(0, x)), cy = Math.min(mh - 1, Math.max(0, y));
          id.data[((y + 1) * (mw + 2) + x + 1) * 4 + 3] = gd[cy * mw + cx] === t ? 255 : 0;
        }
        sc.putImageData(id, 0, 0);
        const mask = document.createElement('canvas'); mask.width = W; mask.height = H; const mc = mask.getContext('2d')!;
        mc.imageSmoothingEnabled = true; mc.drawImage(small, 1, 1, mw, mh, 0, 0, W, H);
        const md = mc.getImageData(0, 0, W, H), d = md.data;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4 + 3, n = hash(x >> 2, y >> 2) * 70 + hash(x >> 1, y >> 1) * 30 - 50;
          d[i] = d[i] + n > 128 ? 255 : 0;
        }
        mc.putImageData(md, 0, 0);
        if (t === 4) { ctx.save(); ctx.globalAlpha = 0.55; ctx.filter = 'brightness(0)'; ctx.drawImage(mask, 0, -3); ctx.restore(); } // dark bank above water
        if (t === 2) { ctx.save(); ctx.globalAlpha = 0.25; ctx.filter = 'brightness(0)'; ctx.drawImage(mask, 0, 2); ctx.restore(); } // kerb shadow
        lc.globalCompositeOperation = 'destination-in'; lc.drawImage(mask, 0, 0);
      }
      ctx.drawImage(layer, 0, 0);
    }
    // soft contact shadows under standing objects
    ctx.fillStyle = 'rgba(10,14,6,0.28)';
    for (const o of this.map.objects) if (o.type === 'deco' && o.kind && !o.kind.startsWith('fence')) {
      const fw = (o.fw ?? 1) * 32; ctx.beginPath(); ctx.ellipse(o.x + 4, o.y - 6, fw * 0.5, Math.max(6, (o.fh ?? 1) * 8), 0, 0, Math.PI * 2); ctx.fill();
    }
    if (this.textures.exists('groundmap')) this.textures.remove('groundmap');
    this.textures.addCanvas('groundmap', cv);
    this.add.image(0, 0, 'groundmap').setOrigin(0, 0).setDepth(-10);
  }
  update(_t: number, dtMs: number) {
    if (this.spawnRect) this.updateSymbols(dtMs);
    this.presence?.update(dtMs);
    if (this.inBattle) return;
    if (panelOpen()) { this.player.setFrame(SHEET_FRAME[this.facing]); this.prompt.setVisible(false); return; }
    const k = this.keys;
    const v = inputToVector({ up: k.up.isDown || k.w.isDown, down: k.down.isDown || k.s.isDown, left: k.left.isDown || k.a.isDown, right: k.right.isDown || k.d.isDown });
    const dt = Math.min(dtMs, 100) / 1000;
    this.pos = moveWithCollision(this.map, this.pos, { x: v.x * PLAYER_SPEED * dt, y: v.y * PLAYER_SPEED * dt });
    const dir = vectorToDirection(v); if (dir) this.facing = dir;
    this.walkT = dir ? this.walkT + dtMs : 0;
    const base = SHEET_FRAME[this.facing], step = Math.floor(this.walkT / 150) % 4; // A, idle, B, idle
    const frame = dir ? (step % 2 ? base : 4 + base * 2 + (step >> 1)) : base;
    this.player.setPosition(Math.round(this.pos.x), Math.round(this.pos.y)).setFrame(frame).setDepth(this.pos.y); // Y-sort by feet
    this.nameTag.setPosition(Math.round(this.pos.x), Math.round(this.pos.y) - 62).setDepth(this.pos.y + 0.2); // BUG-006: tag Y-sorted with its owner
    this.syncT += dtMs;
    const online = this.presence?.status === 'online', every = online ? 120 : POS_SYNC_MS; // room: ~8 Hz, HTTP fallback: 2.5 Hz
    if (this.syncT >= every || (!dir && this.syncT > 120)) { this.syncT = 0; this.syncPosition(); }
    if (online && !dir && this.netMoving) { this.netMoving = false; this.presence!.sendMove(Math.round(this.pos.x), Math.round(this.pos.y), FACE4[this.facing], false); }
    if (dir) this.netMoving = true;
    const t = this.nearest();
    // BUG-0xx fix: the targeted node is tinted and drawn above the player so a tall sprite cannot hide it
    for (const n of this.nodes) { if (t?.kind === 'node' && t.node === n) n.img.setTint(0xfff3a0).setDepth(Math.max(n.y, this.pos.y + 0.1)); else n.img.clearTint().setDepth(n.y); }
    if (t) this.prompt.setText(t.kind === 'node' ? `E: 採集` : `E: 話す`).setPosition(t.x, t.y).setVisible(true); else this.prompt.setVisible(false);
    this.checkPortal();
  }
}
