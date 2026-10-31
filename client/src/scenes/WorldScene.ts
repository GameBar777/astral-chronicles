import Phaser from 'phaser';
import { inputToVector, vectorToDirection, moveWithCollision, PLAYER_SPEED, type Direction, type MapData, type Vec2 } from '@astral/shared';
import asteria from '../../../assets/maps/asteria.json';
import meadow from '../../../assets/maps/green_meadow.json';
import { api, errText, type CharacterDto } from '../api';
import type { BattleView } from './BattleScene';
const FONT = '"DotGothic16", sans-serif';
const MAPS: Record<string, MapData> = { asteria: asteria as unknown as MapData, green_meadow: meadow as unknown as MapData };
interface Symbol { s: Phaser.GameObjects.Image; sh: Phaser.GameObjects.Ellipse; id: string; pos: Vec2; v: Vec2; t: number }
/** char sheet frames: 0 front, 1 left-facing, 2 right-facing, 3 back */
const SHEET_FRAME: Record<Direction, number> = { s: 0, n: 3, w: 1, nw: 1, sw: 1, e: 2, ne: 2, se: 2 };
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
  battleZone?: string; symbols: Symbol[] = []; inBattle = false; cooldownUntil = 0; spawnRect?: { x: number; y: number; w: number; h: number; monsters: string[]; zone: string };
  constructor() { super('World'); }
  create(data: { character: CharacterDto; mapId?: string; spawn?: Vec2 }) {
    this.character = data.character;
    // NOTE: current map/position is client-side until PHASE 4 (server-authoritative movement); server keeps map_id=asteria
    this.map = MAPS[data.mapId ?? this.character.map_id] ?? MAPS.asteria;
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
      } else if (o.type === 'npc') {
        this.add.sprite(o.x, o.y, `ch_${String(o.props?.sheet ?? 'priest')}`, 0).setOrigin(0.5, 1).setDepth(o.y);
        this.add.text(o.x, o.y - 62, String(o.props?.name ?? o.id), { fontFamily: FONT, fontSize: '12px', color: '#ffe08a', backgroundColor: '#0c1020cc', padding: { x: 4, y: 1 } }).setOrigin(0.5, 1).setDepth(1e6);
      }
    }
    const c = this.character;
    const spawnOk = !data.mapId && c.map_id === this.map.id && (c.pos_x || c.pos_y);
    this.pos = data.spawn ? { ...data.spawn } : spawnOk ? { x: c.pos_x, y: c.pos_y } : { ...this.map.spawn };
    // NOTE: appearance (hair/skin/body) is not yet reflected by the generated class sheets (KNOWN LIMITATION, see BUG-007)
    this.player = this.add.sprite(this.pos.x, this.pos.y, `ch_${c.class}`, 0).setOrigin(0.5, 1);
    this.nameTag = this.add.text(0, 0, c.name, { fontFamily: FONT, fontSize: '12px', color: '#fff', backgroundColor: '#0c1020cc', padding: { x: 4, y: 1 } }).setOrigin(0.5, 1).setDepth(1e6);
    this.cameras.main.setBounds(0, 0, this.map.width * 32, this.map.height * 32).startFollow(this.player, true, 0.15, 0.15).setRoundPixels(true).setZoom(1.5); // close 3/4 framing like the art target
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = this.input.keyboard!.addKeys({ up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT, w: K.W, a: K.A, s: K.S, d: K.D }) as any;
    const info = this.add.text(0, 0, `${this.map.name}  WASD/矢印キーで移動`, { fontFamily: FONT, fontSize: '13px', color: '#fff', backgroundColor: '#000a', padding: { x: 6, y: 3 } }).setScrollFactor(0).setDepth(1e7);
    const place = () => info.setPosition(Math.round(this.scale.width / 2 - info.width / 2), this.scale.height - info.height - 8);
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
    if (status === 'defeat') return this.scene.restart({ character: this.character, mapId: 'asteria' }); // revived in town (TD-011)
    // resumed after reload in another map: go back to the battle's field (map position is client-side until PHASE 4)
    if (this.battleZone && this.battleZone !== this.map.id && MAPS[this.battleZone]) return this.scene.restart({ character: this.character, mapId: this.battleZone });
    this.inBattle = false; this.cooldownUntil = this.time.now + 2500;
    if (this.spawnRect && this.symbols.length < 7) this.time.delayedCall(4000, () => this.scene.isActive() && this.spawnSymbol());
  }
  toast(msg: string) {
    const t = this.add.text(this.scale.width / 2, 80, msg, { fontFamily: FONT, fontSize: '14px', color: '#fff', backgroundColor: '#a02020dd', padding: { x: 8, y: 4 } }).setOrigin(0.5).setScrollFactor(0).setDepth(1e7);
    this.time.delayedCall(2500, () => t.destroy());
  }
  checkPortal() {
    const tx = Math.floor(this.pos.x / 32), ty = Math.floor((this.pos.y - 1) / 32);
    const p = this.map.objects.find((o) => o.type === 'portal' && o.fw && tx >= o.tx! && tx < o.tx! + o.fw && ty >= o.ty! && ty < o.ty! + o.fh!);
    if (!p || !MAPS[String(p.props?.to)]) return;
    this.inBattle = true; this.cameras.main.fadeOut(250);
    this.time.delayedCall(260, () => this.scene.restart({ character: this.character, mapId: String(p.props!.to), spawn: p.props!.spawn as Vec2 }));
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
    if (this.inBattle) return;
    const k = this.keys;
    const v = inputToVector({ up: k.up.isDown || k.w.isDown, down: k.down.isDown || k.s.isDown, left: k.left.isDown || k.a.isDown, right: k.right.isDown || k.d.isDown });
    const dt = Math.min(dtMs, 100) / 1000;
    this.pos = moveWithCollision(this.map, this.pos, { x: v.x * PLAYER_SPEED * dt, y: v.y * PLAYER_SPEED * dt });
    const dir = vectorToDirection(v); if (dir) this.facing = dir;
    this.walkT = dir ? this.walkT + dtMs : 0;
    const bob = dir ? [0, -2, 0, -1][Math.floor(this.walkT / 120) % 4] : 0; // 4-direction sheet has no walk frames yet: bob step
    this.player.setPosition(Math.round(this.pos.x), Math.round(this.pos.y) + bob).setFrame(SHEET_FRAME[this.facing]).setDepth(this.pos.y); // Y-sort by feet
    this.nameTag.setPosition(Math.round(this.pos.x), Math.round(this.pos.y) - 62).setDepth(this.pos.y + 0.2); // BUG-006: tag Y-sorted with its owner
    this.checkPortal();
  }
}
