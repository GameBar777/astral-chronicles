import '@fontsource/dotgothic16';
import './style.css';
import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { WorldScene } from './scenes/WorldScene';
import { HudScene } from './scenes/HudScene';
import { session, type CharacterDto } from './api';
import { clearUI, logout, showCharacterSelect, showLogin } from './ui';
export const FONT = '"DotGothic16", sans-serif';

// BUG-002: make sure the Japanese pixel font is loaded before Phaser rasterises any text.
await document.fonts.load(`16px "DotGothic16"`, 'あアア漢字ギルド受付ミーナ始まりの街レベル');
await document.fonts.ready;

const game = new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', backgroundColor: '#10121c', pixelArt: true, roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [BootScene, WorldScene, HudScene],
});
(window as any).__astral = game; // debug hook for automated browser tests

function enterWorld(c: CharacterDto) {
  clearUI();
  const hud = document.createElement('div'); hud.id = 'hudbar'; hud.innerHTML = '<button id="logout">ログアウト</button>';
  document.getElementById('ui')!.appendChild(hud);
  hud.querySelector('button')!.onclick = () => { game.scene.stop('World'); game.scene.stop('Hud'); logout(enterWorld); };
  game.scene.start('World', { character: c });
  game.scene.start('Hud', { character: c });
}
game.events.once('ready', () => { if (session.token) showCharacterSelect(enterWorld); else showLogin(enterWorld); });
