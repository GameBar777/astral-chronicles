import Phaser from 'phaser';
import { inputToVector, vectorToDirection, moveWithCollision, PLAYER_SPEED, type Direction, type MapData, type Vec2 } from '@astral/shared';
import asteria from '../../../assets/maps/asteria.json';
import type { CharacterDto } from '../api';
const FONT = '"DotGothic16", sans-serif';
const MAPS: Record<string, MapData> = { asteria: asteria as unknown as MapData };
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
  constructor() { super('World'); }
  create(data: { character: CharacterDto }) {
    this.character = data.character;
    this.map = MAPS[this.character.map_id] ?? MAPS.asteria;
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
    const spawnOk = c.map_id === this.map.id && (c.pos_x || c.pos_y);
    this.pos = spawnOk ? { x: c.pos_x, y: c.pos_y } : { ...this.map.spawn };
    // NOTE: appearance (hair/skin/body) is not yet reflected by the generated class sheets (KNOWN LIMITATION, see BUG-007)
    this.player = this.add.sprite(this.pos.x, this.pos.y, `ch_${c.class}`, 0).setOrigin(0.5, 1);
    this.nameTag = this.add.text(0, 0, c.name, { fontFamily: FONT, fontSize: '12px', color: '#fff', backgroundColor: '#0c1020cc', padding: { x: 4, y: 1 } }).setOrigin(0.5, 1).setDepth(1e6);
    this.cameras.main.setBounds(0, 0, this.map.width * 32, this.map.height * 32).startFollow(this.player, true, 0.15, 0.15).setRoundPixels(true).setZoom(1.5); // close 3/4 framing like the art target
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = this.input.keyboard!.addKeys({ up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT, w: K.W, a: K.A, s: K.S, d: K.D }) as any;
    const info = this.add.text(0, 0, `${this.map.name}  WASD/矢印キーで移動`, { fontFamily: FONT, fontSize: '13px', color: '#fff', backgroundColor: '#000a', padding: { x: 6, y: 3 } }).setScrollFactor(0).setDepth(1e7);
    const place = () => info.setPosition(Math.round(this.scale.width / 2 - info.width / 2), this.scale.height - info.height - 8);
    place(); this.scale.on('resize', place);
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
    const k = this.keys;
    const v = inputToVector({ up: k.up.isDown || k.w.isDown, down: k.down.isDown || k.s.isDown, left: k.left.isDown || k.a.isDown, right: k.right.isDown || k.d.isDown });
    const dt = Math.min(dtMs, 100) / 1000;
    this.pos = moveWithCollision(this.map, this.pos, { x: v.x * PLAYER_SPEED * dt, y: v.y * PLAYER_SPEED * dt });
    const dir = vectorToDirection(v); if (dir) this.facing = dir;
    this.walkT = dir ? this.walkT + dtMs : 0;
    const bob = dir ? [0, -2, 0, -1][Math.floor(this.walkT / 120) % 4] : 0; // 4-direction sheet has no walk frames yet: bob step
    this.player.setPosition(Math.round(this.pos.x), Math.round(this.pos.y) + bob).setFrame(SHEET_FRAME[this.facing]).setDepth(this.pos.y); // Y-sort by feet
    this.nameTag.setPosition(Math.round(this.pos.x), Math.round(this.pos.y) - 62).setDepth(this.pos.y + 0.2); // BUG-006: tag Y-sorted with its owner
  }
}
