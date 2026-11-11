import Phaser from 'phaser';
import { generateWorldArt } from '../art/placeholderArt';
/** AI-generated original sprites (see scripts/cut-sprites.py, TD-010). Procedural art kept only as fallback. */
export const SPRITE_KINDS = ['house', 'house_wide', 'house_sign', 'tree', 'pine', 'fountain', 'barrel', 'crate', 'lamp', 'sign', 'fence_h', 'fence_v', 'flowers', 'bush', 'stall', 'banner',
  'oak', 'boulder', 'rocks', 'grass_tuft', 'wildflowers', 'stump', 'signpost', 'berry_bush']; // + PHASE 3 meadow props
export const MONSTERS = ['slime', 'horn_rabbit', 'mushroom', 'goblin', 'wild_dog',
  'ruins_bat', 'ruins_skeleton', 'ruins_golem',
  'mine_slimebat', 'mine_beetle', 'mine_goblin', 'mine_golem',
  'forest_wisp', 'forest_sapling', 'forest_treant',
  'desert_scarab', 'desert_mummy', 'desert_sphinx',
  'tower_shard', 'tower_sentinel'];
export const CHAR_SHEETS = ['warrior', 'knight', 'mage', 'priest'];
export const NODE_KINDS = ['node_copper', 'node_iron', 'node_logging', 'node_herb'];
export const NPC_SHEETS = ['npc_shop', 'npc_inn', 'npc_chief', 'npc_smith'];
export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  preload() {
    for (const k of SPRITE_KINDS) this.load.image(`sp_${k}`, `/sprites/${k}.png`);
    for (const c of CHAR_SHEETS) this.load.spritesheet(`ch_${c}`, `/sprites/char_${c}.png`, { frameWidth: 48, frameHeight: 60 });
    this.load.image('groundtex', '/sprites/ground.png');
    for (const m of MONSTERS) this.load.image(`mon_${m}`, `/sprites/mon_${m}.png`);
    for (const k of NODE_KINDS) this.load.image(`sp_${k}`, `/sprites/${k}.png`);
    for (const k of NPC_SHEETS) this.load.image(`ch_${k}`, `/sprites/${k}.png`);
    for (const b of ['meadow', 'ruins', 'mine', 'darkforest', 'desert', 'tower']) this.load.image(`battle_${b}`, `/sprites/battle_${b}.png`);
  }
  create() { generateWorldArt(this); this.game.events.emit('ready'); }
}
