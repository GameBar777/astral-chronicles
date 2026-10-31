import Phaser from 'phaser';
import { inputToVector, vectorToDirection, moveWithCollision, PLAYER_SPEED, type Direction, type MapData, type Vec2 } from '@astral/shared';
import asteria from '../../../assets/maps/asteria.json';

const MAPS: Record<string, MapData> = { asteria: asteria as unknown as MapData };
const DIR_FRAME: Record<Direction, number> = { e: 0, se: 1, s: 2, sw: 3, w: 4, nw: 5, n: 6, ne: 7 };

export class WorldScene extends Phaser.Scene {
  map!: MapData; pos!: Vec2; player!: Phaser.GameObjects.Sprite; nameTag!: Phaser.GameObjects.Text;
  keys!: Record<'up'|'down'|'left'|'right'|'w'|'a'|'s'|'d', Phaser.Input.Keyboard.Key>;
  facing: Direction = 's';
  constructor() { super('World'); }
  create(data: { mapId: string }) {
    this.map = MAPS[data.mapId];
    const tm = this.make.tilemap({ tileWidth: 32, tileHeight: 32, width: this.map.width, height: this.map.height });
    const ts = tm.addTilesetImage('tiles_tmp', 'tiles_tmp', 32, 32, 0, 0, 0)!;
    const ground = tm.createBlankLayer('ground', ts)!;
    const gd = this.map.layers.find((l) => l.name === 'ground')!.data;
    for (let i = 0; i < gd.length; i++) ground.putTileAt(gd[i], i % this.map.width, Math.floor(i / this.map.width));
    ground.setDepth(-1);
    for (const o of this.map.objects.filter((o) => o.type === 'npc')) {
      const s = this.add.sprite(o.x, o.y, 'player_tmp', 2).setOrigin(0.5, 1).setTint(0xff9090).setDepth(o.y);
      this.add.text(o.x, o.y - 50, String(o.props?.name ?? o.id), { fontSize: '11px', color: '#ffe', backgroundColor: '#0008' }).setOrigin(0.5, 1).setDepth(1e6);
      void s;
    }
    this.pos = { ...this.map.spawn };
    this.player = this.add.sprite(this.pos.x, this.pos.y, 'player_tmp', DIR_FRAME.s).setOrigin(0.5, 1);
    this.nameTag = this.add.text(0, 0, 'あなた', { fontSize: '11px', color: '#fff', backgroundColor: '#0008' }).setOrigin(0.5, 1).setDepth(1e6);
    const W = this.map.width * 32, H = this.map.height * 32;
    this.cameras.main.setBounds(0, 0, W, H).startFollow(this.player, true, 0.15, 0.15).setRoundPixels(true);
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = this.input.keyboard!.addKeys({ up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT, w: K.W, a: K.A, s: K.S, d: K.D }) as any;
    this.add.text(8, 8, `${this.map.name}（仮マップ・仮素材）  WASD/矢印キーで移動`, { fontSize: '13px', color: '#fff', backgroundColor: '#000a', padding: { x: 4, y: 2 } }).setScrollFactor(0).setDepth(1e7);
  }
  update(_t: number, dtMs: number) {
    const k = this.keys;
    const v = inputToVector({ up: k.up.isDown || k.w.isDown, down: k.down.isDown || k.s.isDown, left: k.left.isDown || k.a.isDown, right: k.right.isDown || k.d.isDown });
    const dt = Math.min(dtMs, 100) / 1000;
    this.pos = moveWithCollision(this.map, this.pos, { x: v.x * PLAYER_SPEED * dt, y: v.y * PLAYER_SPEED * dt });
    const dir = vectorToDirection(v); if (dir) this.facing = dir;
    this.player.setPosition(this.pos.x, this.pos.y).setFrame(DIR_FRAME[this.facing]).setDepth(this.pos.y); // Y-sort
    this.nameTag.setPosition(this.pos.x, this.pos.y - 50);
  }
}
