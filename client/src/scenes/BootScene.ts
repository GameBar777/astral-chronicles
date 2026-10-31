import Phaser from 'phaser';
/** TEMP placeholder art generated at runtime (SECTION 02: placeholders are tracked as such). */
const TILE_COLORS: Record<number, [number, number]> = {
  1: [0x5a9e4b, 0x4e8a41], 2: [0xc8a96a, 0xb8995a], 3: [0x3b6fb6, 0x5a8fd6], 4: [0x8a7a6a, 0x6a5a4a],
  5: [0x2f6b2f, 0x1f4b1f], 6: [0xa8a8b0, 0x8f8f98], 7: [0xa04030, 0x803020],
};
export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  create() {
    const g = this.add.graphics();
    // tileset: 8 tiles in a row (index 0 = empty)
    for (let i = 0; i < 8; i++) {
      const [a, b] = TILE_COLORS[i] ?? [0x000000, 0x000000];
      g.fillStyle(a).fillRect(i * 32, 0, 32, 32);
      g.fillStyle(b);
      for (let k = 0; k < 6; k++) g.fillRect(i * 32 + ((k * 13 + i * 7) % 28), (k * 11) % 28, 3, 3);
      if (i === 5) { g.fillStyle(0x1a3a1a).fillCircle(i * 32 + 16, 14, 12); g.fillStyle(0x5a3a1a).fillRect(i * 32 + 13, 22, 6, 10); }
      if (i === 4) { g.lineStyle(1, 0x4a3a2a).strokeRect(i * 32 + 0.5, 0.5, 31, 31); }
    }
    g.generateTexture('tiles_tmp', 256, 32); g.clear();
    // player 32x48 placeholder, 8 frames (one per direction e,se,s,sw,w,nw,n,ne)
    const dirs = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
    dirs.forEach(([dx, dy], f) => {
      const ox = f * 32;
      g.fillStyle(0x000000, 0.25).fillEllipse(ox + 16, 45, 20, 6);
      g.fillStyle(0x3050c0).fillRect(ox + 9, 20, 14, 18);          // body
      g.fillStyle(0x503020).fillRect(ox + 10, 38, 5, 8).fillRect(ox + 17, 38, 5, 8); // legs
      g.fillStyle(0xf0c8a0).fillCircle(ox + 16, 13, 8);            // head
      g.fillStyle(0x603010).fillRect(ox + 8, 4, 16, 5);            // hair
      g.fillStyle(0x000000).fillRect(ox + 15 + dx * 4, 12 + dy * 3, 2, 2); // facing marker
      g.lineStyle(1, 0x101010).strokeRect(ox + 9.5, 20.5, 13, 17);
    });
    g.generateTexture('player_tmp', 256, 48); g.destroy();
    const t = this.textures.get('player_tmp');
    for (let f = 0; f < 8; f++) t.add(f, 0, f * 32, 0, 32, 48);
    this.scene.start('World', { mapId: 'asteria' });
  }
}
