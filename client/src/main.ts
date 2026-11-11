import '@fontsource/dotgothic16';
import './style.css';
import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { WorldScene } from './scenes/WorldScene';
import { HudScene } from './scenes/HudScene';
import { BattleScene } from './scenes/BattleScene';
import { DungeonScene } from './scenes/DungeonScene';
import { session, type CharacterDto } from './api';
import { mountChat } from './chat';
import { mountSocial } from './social';
import { mountTouch } from './touch';
import { playBgm, sfx } from './audio';
import { clearUI, logout, showCharacterSelect, showLogin } from './ui';
export const FONT = '"DotGothic16", sans-serif';

// BUG-002: make sure the Japanese pixel font is loaded before Phaser rasterises any text.
await document.fonts.load(`16px "DotGothic16"`, 'あアア漢字ギルド受付ミーナ始まりの街レベル');
await document.fonts.ready;

const game = new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', backgroundColor: '#10121c', pixelArt: true, roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [BootScene, WorldScene, HudScene, BattleScene, DungeonScene],
});
(window as any).__astral = game; // debug hook for automated browser tests

function enterWorld(c: CharacterDto) {
  clearUI();
  const hud = document.createElement('div'); hud.id = 'hudbar'; hud.innerHTML = '<button id="menu-btn">メニュー [M]</button><button id="logout">ログアウト</button>';
  document.getElementById('ui')!.appendChild(hud);
  mountChat(document.getElementById('ui')!, c.name); mountSocial(document.getElementById('ui')!, c.id);
  mountTouch(document.body);
  (hud.querySelector('#menu-btn') as HTMLButtonElement).onclick = () => (window as any).__astralMenu?.();
  (hud.querySelector('#logout') as HTMLButtonElement).onclick = () => { document.getElementById('touch')?.remove(); playBgm('title'); game.scene.stop('Battle'); game.scene.stop('Dungeon'); game.scene.stop('World'); game.scene.stop('Hud'); logout(enterWorld); };
  game.scene.start('World', { character: c });
  game.scene.start('Hud', { character: c });
}
game.events.on('character', (c: CharacterDto) => { game.scene.getScene('Hud') && game.scene.start('Hud', { character: c }); }); // refresh HUD after battle
game.events.once('ready', () => { playBgm('title'); if (session.token) showCharacterSelect(enterWorld); else showLogin(enterWorld); });
// PHASE 10: soft click on any UI button (SFX volume / mute from settings)
document.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest?.('button'); if (b && !b.classList.contains('mn')) sfx('menu'); }, true);
