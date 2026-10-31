import Phaser from 'phaser';
import { expToNext } from '@astral/shared';
import type { CharacterDto } from '../api';
import { CLASS_JA } from '../ui';
const FONT = '"DotGothic16", sans-serif';
/** Status panel: dark navy plate, double gold frame, class crest, rounded gradient bars, coin + gold. */
export class HudScene extends Phaser.Scene {
  c!: CharacterDto;
  constructor() { super('Hud'); }
  create(data: { character: CharacterDto }) {
    this.c = data.character; const c = this.c;
    const X = 10, Y = 10, PW = 272, PH = 118;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.45).fillRoundedRect(X + 3, Y + 4, PW, PH, 8);
    g.fillStyle(0x3a2a14).fillRoundedRect(X - 2, Y - 2, PW + 4, PH + 4, 9);
    g.fillGradientStyle(0x1e2744, 0x1e2744, 0x0d1224, 0x0d1224, 0.96).fillRoundedRect(X, Y, PW, PH, 7);
    g.lineStyle(2, 0xd9b45e).strokeRoundedRect(X, Y, PW, PH, 7).lineStyle(1, 0x8a6a2e).strokeRoundedRect(X + 4, Y + 4, PW - 8, PH - 8, 5);
    // crest (shield) with level
    const sx = X + 34, sy = Y + 38;
    g.fillStyle(0x8a6a2e).fillCircle(sx, sy, 25).fillStyle(0x24305a).fillCircle(sx, sy, 22).lineStyle(2, 0xf0d080).strokeCircle(sx, sy, 22);
    this.add.text(sx, sy - 9, 'Lv', { fontFamily: FONT, fontSize: '11px', color: '#f0d080' }).setOrigin(0.5);
    this.add.text(sx, sy + 6, String(c.level), { fontFamily: FONT, fontSize: '20px', color: '#fff4cc', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
    this.add.text(X + 66, Y + 10, `${c.name}`, { fontFamily: FONT, fontSize: '15px', color: '#ffe08a', stroke: '#000', strokeThickness: 3 });
    this.add.text(X + PW - 12, Y + 12, `Lv.${c.level} ${CLASS_JA[c.class]}`, { fontFamily: FONT, fontSize: '12px', color: '#c8d0f0' }).setOrigin(1, 0);
    const bar = (y: number, label: string, v: number, max: number, top: number, bot: number) => {
      const bx = X + 92, bw = PW - 104, r = max > 0 ? Math.min(1, v / max) : 0;
      this.add.text(X + 66, y - 2, label, { fontFamily: FONT, fontSize: '12px', color: '#f4ecd8', stroke: '#000', strokeThickness: 2 });
      g.fillStyle(0x05070e).fillRoundedRect(bx - 1, y - 1, bw + 2, 14, 6);
      if (r > 0) g.fillGradientStyle(top, top, bot, bot, 1).fillRoundedRect(bx, y, Math.max(12, Math.round(bw * r)), 12, 5);
      g.fillStyle(0xffffff, 0.18).fillRoundedRect(bx + 2, y + 1, Math.max(8, Math.round(bw * r) - 4), 3, 2);
      g.lineStyle(1, 0x9a8250).strokeRoundedRect(bx - 1, y - 1, bw + 2, 14, 6);
      this.add.text(bx + bw / 2, y + 6, `${v} / ${max}`, { fontFamily: FONT, fontSize: '11px', color: '#fff', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
    };
    bar(Y + 36, 'HP', c.hp, c.max_hp, 0xf05a4a, 0x9a1a1a);
    bar(Y + 56, 'MP', c.mp, c.max_mp, 0x5a9af0, 0x1a3a9a);
    const need = expToNext(c.level); bar(Y + 76, 'EX', need === null ? 1 : c.exp, need ?? 1, 0xf0d060, 0x9a7a1a);
    // gold coin
    const cy = Y + 102; g.fillStyle(0x8a5a10).fillCircle(X + 74, cy, 7).fillStyle(0xf8d048).fillCircle(X + 74, cy - 1, 6).fillStyle(0xfff0a0).fillCircle(X + 72, cy - 3, 2);
    this.add.text(X + 86, cy - 8, `${c.gold.toLocaleString()} G`, { fontFamily: FONT, fontSize: '13px', color: '#ffe08a', stroke: '#000', strokeThickness: 3 });
    if (need === null) this.add.text(X + PW - 12, cy - 8, 'MAX', { fontFamily: FONT, fontSize: '12px', color: '#ffd77a' }).setOrigin(1, 0);
  }
}
