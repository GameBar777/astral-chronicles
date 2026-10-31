import Phaser from 'phaser';
import { expToNext } from '@astral/shared';
import type { CharacterDto } from '../api';
import { CLASS_JA } from '../ui';
const FONT = '"DotGothic16", sans-serif';
export class HudScene extends Phaser.Scene {
  c!: CharacterDto;
  constructor() { super('Hud'); }
  create(data: { character: CharacterDto }) {
    this.c = data.character; const c = this.c;
    const g = this.add.graphics();
    g.fillStyle(0x141a30, 0.92).fillRect(8, 8, 230, 112).lineStyle(2, 0xc9a55a).strokeRect(8, 8, 230, 112);
    const t = (x: number, y: number, s: string, col = '#f4ecd8') => this.add.text(x, y, s, { fontFamily: FONT, fontSize: '14px', color: col });
    t(16, 14, `${c.name}  Lv.${c.level} ${CLASS_JA[c.class]}`, '#ffd77a');
    const bar = (y: number, label: string, v: number, max: number, col: number) => {
      t(16, y - 2, label); g.fillStyle(0x000000).fillRect(52, y, 140, 12); g.fillStyle(col).fillRect(52, y, Math.round(140 * Math.min(1, v / Math.max(1, max))), 12);
      g.lineStyle(1, 0x8a7a5a).strokeRect(52, y, 140, 12); this.add.text(196, y - 2, `${v}/${max}`, { fontFamily: FONT, fontSize: '11px', color: '#fff' });
    };
    bar(38, 'HP', c.hp, c.max_hp, 0xd03a3a); bar(58, 'MP', c.mp, c.max_mp, 0x3a6ad0);
    const need = expToNext(c.level); bar(78, 'EXP', c.exp, need ?? 1, 0xd0b03a);
    t(16, 98, `所持金 ${c.gold.toLocaleString()} G`, '#ffe9a0');
    if (need === null) t(150, 98, 'MAX', '#ffd77a');
  }
}
