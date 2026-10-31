import Phaser from 'phaser';
import { generateWorldArt } from '../art/placeholderArt';
export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  create() { generateWorldArt(this); this.game.events.emit('ready'); }
}
