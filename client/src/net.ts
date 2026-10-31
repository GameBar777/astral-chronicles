import Phaser from 'phaser';
import { Client, getStateCallbacks, type Room } from 'colyseus.js';
import { session } from './api';
/**
 * PHASE 6 presence: joins the shared map room (server-authoritative positions) and renders other players + name tags.
 * Own movement is still predicted locally; the server validates every "move" and answers "correct" when it rejects one.
 */
const FONT = '"DotGothic16", sans-serif';
const FRAME: Record<string, number> = { down: 0, left: 1, right: 2, up: 3 };
export const wsEndpoint = () => (import.meta as any).env?.VITE_GAME_WS ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:2567`;
import { chatBus } from './chat';
import { socialBus } from './social';
import { dungeonBus } from './dungeonBus';
type Remote = { spr: Phaser.GameObjects.Sprite; tag: Phaser.GameObjects.Text; tx: number; ty: number; facing: string; moving: boolean; t: number };
export class Presence {
  room?: Room; remotes = new Map<string, Remote>(); status: 'connecting' | 'online' | 'reconnecting' | 'offline' = 'connecting';
  private closed = false; private client = new Client(wsEndpoint());
  constructor(private scene: Phaser.Scene, private characterId: string, private mapId: string,
    private onCorrect: (pos: { x: number; y: number }) => void, private onStatus: (s: string) => void) {}
  async connect() {
    try { this.attach(await this.client.joinOrCreate('world', { token: session.token, characterId: this.characterId, mapId: this.mapId })); }
    catch { this.setStatus('offline'); if (!this.closed) this.scene.time.delayedCall(3000, () => !this.closed && this.connect()); }
  }
  private setStatus(s: Presence['status']) { this.status = s; this.onStatus(s); }
  private attach(room: Room) {
    if (this.closed) { room.leave(true); return; }
    this.room = room; this.setStatus('online');
    const $ = getStateCallbacks(room) as any;
    $(room.state).players.onAdd((p: any, key: string) => {
      if (p.id === this.characterId) return;
      const r = this.remotes.get(key) ?? this.spawn(key, p); r.tx = p.x; r.ty = p.y;
      const label = () => r.tag.setText(p.inBattle ? `[戦闘中] ${p.name}` : p.name).setColor(p.inBattle ? '#ffb08a' : '#bfe6ff'); label();
      $(p).onChange(() => { r.tx = p.x; r.ty = p.y; r.facing = p.facing; r.moving = p.moving; label(); });
    });
    $(room.state).players.onRemove((_p: any, key: string) => { const r = this.remotes.get(key); r?.spr.destroy(); r?.tag.destroy(); this.remotes.delete(key); });
    room.onMessage('chat', (m: any) => chatBus.onMsg(m)); room.onMessage('chat_history', (h: any) => chatBus.onHistory(h ?? []));
    room.onMessage('chat_error', (m: any) => chatBus.onError(m?.code)); room.onMessage('social', () => socialBus.refresh());
    room.onMessage('dungeon', (m: any) => dungeonBus.onMsg?.(m)); room.onMessage('battle', () => {}); room.onMessage('battle_wait', () => {});
    chatBus.send = (channel, body) => { if (this.room !== room || this.status !== 'online') return false; room.send('chat', { channel, body }); return true; };
    room.onMessage('correct', (m: any) => m?.pos && this.onCorrect(m.pos));
    room.onLeave((code) => {
      if (this.room === room) chatBus.send = null;
      if (this.closed) return;
      if (code === 4001) { this.setStatus('offline'); return; } // logged in elsewhere: do not fight the other tab
      this.reconnect(room.reconnectionToken);
    });
  }
  private async reconnect(token: string) {
    this.setStatus('reconnecting');
    for (let i = 0; i < 6 && !this.closed; i++) {
      await new Promise((r) => setTimeout(r, 500 + i * 700));
      try { const room = await this.client.reconnect(token); this.clearRemotes(); this.attach(room); return; } catch { /* retry */ }
    }
    this.clearRemotes(); this.room = undefined; if (!this.closed) this.connect(); // grace expired: fresh join
  }
  private spawn(key: string, p: any): Remote {
    const spr = this.scene.add.sprite(p.x, p.y, `ch_${p.cls}`, 0).setOrigin(0.5, 1).setDepth(p.y);
    const tag = this.scene.add.text(p.x, p.y - 62, p.name, { fontFamily: FONT, fontSize: '12px', color: '#bfe6ff', backgroundColor: '#0c1020cc', padding: { x: 4, y: 1 } }).setOrigin(0.5, 1).setDepth(p.y + 0.2);
    const r = { spr, tag, tx: p.x, ty: p.y, facing: p.facing, moving: p.moving, t: 0 }; this.remotes.set(key, r); return r;
  }
  private clearRemotes() { for (const r of this.remotes.values()) { r.spr.destroy(); r.tag.destroy(); } this.remotes.clear(); }
  /** interpolate remotes toward their last server position */
  update(dtMs: number) {
    const k = Math.min(1, dtMs / 90);
    for (const r of this.remotes.values()) {
      const x = r.spr.x + (r.tx - r.spr.x) * k, y = r.spr.y + (r.ty - r.spr.y) * k; r.t += dtMs;
      const moving = r.moving || Math.hypot(r.tx - x, r.ty - y) > 1, base = FRAME[r.facing] ?? 0, step = Math.floor(r.t / 150) % 4;
      r.spr.setPosition(x, y).setFrame(moving ? (step % 2 ? base : 4 + base * 2 + (step >> 1)) : base).setDepth(y - 0.01); // own sprite wins ties
      r.tag.setPosition(Math.round(x), Math.round(y) - 62).setDepth(y + 0.2);
    }
  }
  sendMove(x: number, y: number, facing: string, moving: boolean) { if (this.status === 'online') this.room?.send('move', { x, y, facing, moving }); return this.status === 'online'; }
  close() { this.closed = true; this.room?.leave(true).catch?.(() => {}); this.clearRemotes(); }
}
