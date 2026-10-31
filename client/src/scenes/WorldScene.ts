import Phaser from 'phaser';
import { inputToVector, vectorToDirection, moveWithCollision, PLAYER_SPEED, type Direction, type MapData, type Vec2 } from '@astral/shared';
import asteria from '../../../assets/maps/asteria.json';
import { characterTexture, DIR_INDEX } from '../art/placeholderArt';
import type { CharacterDto } from '../api';
const FONT = '"DotGothic16", sans-serif';
const MAPS: Record<string, MapData> = { asteria: asteria as unknown as MapData };
const TEX_H: Record<string, number> = { house: 160, house_wide: 160, tree: 96, pine: 96, fountain: 112, fence_h: 48, fence_v: 48, barrel: 40, crate: 40, lamp: 80, stall: 96, sign: 48 };

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
    const tm = this.make.tilemap({ tileWidth: 32, tileHeight: 32, width: this.map.width, height: this.map.height });
    const ts = tm.addTilesetImage('tiles', 'tiles', 32, 32, 0, 0, 0)!;
    const ground = tm.createBlankLayer('ground', ts)!;
    const gd = this.map.layers.find((l) => l.name === 'ground')!.data;
    for (let i = 0; i < gd.length; i++) ground.putTileAt(gd[i], i % this.map.width, Math.floor(i / this.map.width));
    ground.setDepth(-10);
    this.props = [];
    for (const o of this.map.objects) {
      if (o.type === 'deco' && o.kind) {
        const img = this.add.image(o.x, o.y + (o.kind.startsWith('fence') ? 8 : o.kind === 'barrel' || o.kind === 'crate' ? 4 : 0), `obj_${o.kind}`).setOrigin(0.5, 1).setDepth(o.y);
        img.setData('kind', o.kind); this.props.push(img);
        if (o.label) this.add.text(o.x, o.y - TEX_H[o.kind] + 4, o.label, { fontFamily: FONT, fontSize: '12px', color: '#fff', backgroundColor: '#3a2410cc', padding: { x: 4, y: 1 } }).setOrigin(0.5, 0).setDepth(o.y + 0.5);
      } else if (o.type === 'npc') {
        const key = characterTexture(this, 'npc_tex', { cls: 'npc', hair: 2, skin: 0, body: 'b', hairStyle: 1 });
        this.add.sprite(o.x, o.y, key, DIR_INDEX.s * 3).setOrigin(0.5, 1).setDepth(o.y);
        this.add.text(o.x, o.y - 50, String(o.props?.name ?? o.id), { fontFamily: FONT, fontSize: '12px', color: '#ffe9a0', backgroundColor: '#000a', padding: { x: 3, y: 1 } }).setOrigin(0.5, 1).setDepth(1e6);
      }
    }
    const c = this.character;
    const spawnOk = c.map_id === this.map.id && (c.pos_x || c.pos_y);
    this.pos = spawnOk ? { x: c.pos_x, y: c.pos_y } : { ...this.map.spawn };
    const ap = c.appearance;
    const key = characterTexture(this, `pc_${c.class}_${ap.bodyType}${ap.hairStyle}${ap.hairColor}${ap.skinColor}`, { cls: c.class, hair: ap.hairColor, skin: ap.skinColor, body: ap.bodyType, hairStyle: ap.hairStyle });
    this.player = this.add.sprite(this.pos.x, this.pos.y, key, DIR_INDEX.s * 3).setOrigin(0.5, 1);
    this.nameTag = this.add.text(0, 0, c.name, { fontFamily: FONT, fontSize: '12px', color: '#fff', backgroundColor: '#000a', padding: { x: 3, y: 1 } }).setOrigin(0.5, 1).setDepth(1e6);
    this.cameras.main.setBounds(0, 0, this.map.width * 32, this.map.height * 32).startFollow(this.player, true, 0.15, 0.15).setRoundPixels(true);
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = this.input.keyboard!.addKeys({ up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT, w: K.W, a: K.A, s: K.S, d: K.D }) as any;
    const info = this.add.text(0, 0, `${this.map.name}（仮マップ・仮素材）  WASD/矢印キーで移動`, { fontFamily: FONT, fontSize: '13px', color: '#fff', backgroundColor: '#000a', padding: { x: 6, y: 3 } }).setScrollFactor(0).setDepth(1e7);
    const place = () => info.setPosition(Math.round(this.scale.width / 2 - info.width / 2), this.scale.height - info.height - 8);
    place(); this.scale.on('resize', place);
  }
  update(_t: number, dtMs: number) {
    const k = this.keys;
    const v = inputToVector({ up: k.up.isDown || k.w.isDown, down: k.down.isDown || k.s.isDown, left: k.left.isDown || k.a.isDown, right: k.right.isDown || k.d.isDown });
    const dt = Math.min(dtMs, 100) / 1000;
    this.pos = moveWithCollision(this.map, this.pos, { x: v.x * PLAYER_SPEED * dt, y: v.y * PLAYER_SPEED * dt });
    const dir = vectorToDirection(v); if (dir) this.facing = dir;
    this.walkT = dir ? this.walkT + dtMs : 0;
    const frame = dir ? [1, 0, 2, 0][Math.floor(this.walkT / 140) % 4] : 0;
    this.player.setPosition(Math.round(this.pos.x), Math.round(this.pos.y)).setFrame(DIR_INDEX[this.facing] * 3 + frame).setDepth(this.pos.y); // Y-sort by feet
    this.nameTag.setPosition(Math.round(this.pos.x), Math.round(this.pos.y) - 50).setDepth(this.pos.y + 0.2); // BUG-006: tag Y-sorted with its owner
  }
}
