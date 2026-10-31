import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { WorldScene } from './scenes/WorldScene';
const game = new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', backgroundColor: '#1a1a2e', pixelArt: true, roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [BootScene, WorldScene],
});
(window as any).__astral = game; // debug hook for automated browser tests
