import { Room, type Client, ServerError } from 'colyseus';
import { Schema, MapSchema, defineTypes } from '@colyseus/schema';
import { pool } from '../db/pool.js';
import { resolveSession } from '../services/auth.js';
import { updatePosition } from '../services/world.js';
import { MAPS } from '../world/maps.js';
/**
 * PHASE 6 shared map room (one per mapId via filterBy). Auth = the same session token as the REST API.
 * Positions are server-authoritative: a "move" is validated by updatePosition (map/collision/speed, DB-stored) before it is
 * written into the synced state; rejected moves get a "correct" message with the stored position.
 */
// NOTE: `declare` fields (no initializers) so class-field semantics don't shadow the schema accessors
export class Player extends Schema { declare id: string; declare name: string; declare cls: string; declare x: number; declare y: number; declare facing: string; declare moving: boolean;
  constructor() { super(); this.facing = 'down'; this.moving = false; } }
defineTypes(Player, { id: 'string', name: 'string', cls: 'string', x: 'number', y: 'number', facing: 'string', moving: 'boolean' });
export class WorldState extends Schema { declare mapId: string; declare players: MapSchema<Player>; constructor() { super(); this.mapId = ''; this.players = new MapSchema<Player>(); } }
defineTypes(WorldState, { mapId: 'string', players: { map: Player } });
type Auth = { userId: string; characterId: string; name: string; cls: string; x: number; y: number };
const FACINGS = new Set(['up', 'down', 'left', 'right']);
export const RECONNECT_SEC = 15;
export class WorldRoom extends Room<WorldState> {
  maxClients = 100;
  private busy = new Map<string, boolean>();
  private pending = new Map<string, any>();
  private kicked = new Set<string>();
  private grace = new Map<string, { reject: (e?: unknown) => void }>(); // sessionId -> pending reconnection
  onCreate(opts: { mapId: string }) {
    if (!MAPS[opts.mapId]) throw new ServerError(404, 'map_not_found');
    this.setState(new WorldState()); this.state.mapId = opts.mapId;
    this.setPatchRate(50);
    this.onMessage('move', (client, m) => this.move(client, m));
  }
  async onAuth(_client: Client, opts: { token?: string; characterId?: string; mapId?: string }) {
    const s = await resolveSession(opts?.token);
    if (!s) throw new ServerError(401, 'unauthorized');
    const r = await pool.query('SELECT id,name,class,map_id,pos_x,pos_y FROM characters WHERE id::text=$1 AND user_id=$2 AND deleted_at IS NULL', [String(opts?.characterId ?? ''), s.userId]);
    const ch = r.rows[0]; if (!ch) throw new ServerError(404, 'character_not_found');
    if (ch.map_id !== this.state.mapId) throw new ServerError(409, 'wrong_map');
    return { userId: s.userId, characterId: ch.id, name: ch.name, cls: ch.class, x: ch.pos_x, y: ch.pos_y } satisfies Auth;
  }
  onJoin(client: Client, _o: unknown, a: Auth) {
    for (const other of this.clients) if (other !== client && (other.auth as Auth)?.characterId === a.characterId) { this.kicked.add(other.sessionId); other.leave(4001, 'duplicate_login'); } // same character from a second tab
    this.state.players.forEach((q, sid) => { // reload / new tab while the old seat is still in its reconnection grace: drop the ghost
      if (sid !== client.sessionId && q.id === a.characterId) { this.state.players.delete(sid); this.grace.get(sid)?.reject(new Error('superseded')); }
    });
    const p = new Player(); Object.assign(p, { id: a.characterId, name: a.name, cls: a.cls, x: a.x, y: a.y });
    this.state.players.set(client.sessionId, p);
  }
  private async move(client: Client, m: any) {
    const a = client.auth as Auth, p = this.state.players.get(client.sessionId); if (!a || !p) return;
    if (this.busy.get(client.sessionId)) { this.pending.set(client.sessionId, m); return; } // coalesce: keep only the latest
    this.busy.set(client.sessionId, true);
    try {
      let next = m;
      while (next) {
        this.pending.delete(client.sessionId);
        if (FACINGS.has(next?.facing)) p.facing = next.facing; p.moving = !!next?.moving;
        const r: any = await updatePosition(a.userId, a.characterId, { mapId: this.state.mapId, x: next?.x, y: next?.y }).catch(() => ({ ok: false, pos: null }));
        if (r.pos) { p.x = r.pos.x; p.y = r.pos.y; }
        if (!r.ok) { client.send('correct', { reason: r.reason ?? 'invalid', pos: r.pos }); if (r.reason === 'wrong_map') { this.kicked.add(client.sessionId); return client.leave(4002, 'wrong_map'); } }
        next = this.pending.get(client.sessionId);
      }
    } finally { this.busy.set(client.sessionId, false); }
  }
  async onLeave(client: Client, consented: boolean) {
    const p = this.state.players.get(client.sessionId);
    if (p && !consented && !this.kicked.delete(client.sessionId)) {
      p.moving = false;
      const d = this.allowReconnection(client, RECONNECT_SEC); this.grace.set(client.sessionId, d as any);
      try { await d; this.grace.delete(client.sessionId); return; } catch { this.grace.delete(client.sessionId); /* timed out or superseded */ }
    }
    this.state.players.delete(client.sessionId); this.busy.delete(client.sessionId); this.pending.delete(client.sessionId);
  }
}
