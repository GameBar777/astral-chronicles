import Phaser from 'phaser';
import { generateWorldArt } from '../art/placeholderArt';
/** AI-generated original sprites (see scripts/cut-sprites.py, TD-010). Procedural art kept only as fallback. */
export const SPRITE_KINDS = ['house', 'house_wide', 'house_sign', 'tree', 'pine', 'fountain', 'barrel', 'crate', 'lamp', 'sign', 'fence_h', 'fence_v', 'flowers', 'bush', 'stall', 'banner',
  'oak', 'boulder', 'rocks', 'grass_tuft', 'wildflowers', 'stump', 'signpost', 'berry_bush']; // + PHASE 3 meadow props
export const MONSTERS = ['slime', 'horn_rabbit', 'mushroom', 'goblin', 'wild_dog'];
export const CHAR_SHEETS = ['warrior', 'knight', 'mage', 'priest'];
export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  preload() {
    for (const k of SPRITE_KINDS) this.load.image(`sp_${k}`, `/sprites/${k}.png`);
    for (const c of CHAR_SHEETS) this.load.spritesheet(`ch_${c}`, `/sprites/char_${c}.png`, { frameWidth: 48, frameHeight: 60 });
    this.load.image('groundtex', '/sprites/ground.png');
    for (const m of MONSTERS) this.load.image(`mon_${m}`, `/sprites/mon_${m}.png`);
    this.load.image('battle_meadow', '/sprites/battle_meadow.png');
  }
  create() { generateWorldArt(this); this.game.events.emit('ready'); }
}
