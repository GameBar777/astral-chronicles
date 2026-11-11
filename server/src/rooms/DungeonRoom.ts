import { Room, type Client, ServerError } from 'colyseus';
import { Schema, MapSchema, defineTypes } from '@colyseus/schema';
import { pool } from '../db/pool.js';
import { resolveSession } from '../services/auth.js';
import { hub } from './hub.js';
import { postChat } from '../services/social.js';
import { RECONNECT_SEC, Player } from './WorldRoom.js';
import { dungeonRoomReg } from './dungeonSync.js';
import { updateDungeonPosition, floorMap } from '../services/dungeon.js';
/**
 * Instance channel (one room per dungeon instance, filterBy instanceId). Presence, chat, and
 * server-validated walking; dungeon/battle authority still lives in Postgres (REST + push).
 */
class DungeonState extends Schema { declare mapId: string; declare players: MapSchema<Player>;
  constructor() { super(); this.mapId = ''; this.players = new MapSchema<Player>(); } }
defineTypes(DungeonState, { mapId: 'string', players: { map: Player } });
type Auth = { userId: string; characterId: string; name: string; cls: string; x: number; y: number; look: string };
const FACINGS = new Set(['up', 'down', 'left', 'right']);
export class DungeonRoom extends Room<DungeonState> {
  maxClients = 4;
  private instanceId = '';
  private kicked = new Set<string>();
  private busy = new Map<string, boolean>();
  private pending = new Map<string, any>();
  onCreate(opts: { instanceId: string }) {
    this.instanceId = String(opts.instanceId ?? '');
    this.setState(new DungeonState()); this.setPatchRate(50);
    this.onMessage('chat', (client, m) => this.chat(client, m));
    this.onMessage('move', (client, m) => this.move(client, m));
    this.onMessage('battle_ready', (client) => { const a = client.auth as Auth; if (a) hub.setBattleReady(a.characterId, true); });
    this.onMessage('battle_idle', (client) => { const a = client.auth as Auth; if (a) hub.setBattleReady(a.characterId, false); });
    dungeonRoomReg.set(this.instanceId, this);
  }
  snap(mapId: string, x: number, y: number) {
    this.state.mapId = mapId;
    this.state.players.forEach((p) => { p.x = x; p.y = y; p.moving = false; });
  }
  async onAuth(_c: Client, opts: { token?: string; characterId?: string; instanceId?: string }) {
    const s = await resolveSession(opts?.token); if (!s) throw new ServerError(401, 'unauthorized');
    const r = await pool.query(`SELECT c.id,c.name,c.class,c.appearance,i.dungeon_id,i.current_floor,m.pos_x,m.pos_y
      FROM characters c JOIN dungeon_members m ON m.character_id=c.id AND m.left_at IS NULL
      JOIN dungeon_instances i ON i.id=m.instance_id
      WHERE c.id::text=$1 AND c.user_id=$2 AND c.deleted_at IS NULL AND m.instance_id::text=$3`, [String(opts?.characterId ?? ''), s.userId, this.instanceId]);
    const row = r.rows[0]; if (!row) throw new ServerError(403, 'not_member');
    const map = floorMap(row.dungeon_id, row.current_floor);
    if (!this.state.mapId) this.state.mapId = map.id;
    const x = row.pos_x ?? Math.round(map.spawn.x), y = row.pos_y ?? Math.round(map.spawn.y);
    return { userId: s.userId, characterId: row.id, name: row.name, cls: row.class, x, y, look: JSON.stringify(row.appearance ?? {}) } satisfies Auth;
  }
  private ids() { return this.clients.map((c) => (c.auth as Auth)?.characterId).filter(Boolean); }
  private pingPresence() { this.broadcast('dungeon', { type: 'presence' }); }
  onJoin(client: Client, _o: unknown, a: Auth) {
    for (const o of this.clients) if (o !== client && (o.auth as Auth)?.characterId === a.characterId) { this.kicked.add(o.sessionId); o.leave(4001, 'duplicate_login'); }
    const p = new Player(); Object.assign(p, { id: a.characterId, name: a.name, cls: a.cls, x: a.x, y: a.y, look: a.look });
    this.state.players.set(client.sessionId, p);
    hub.set(a.characterId, { client, room: this, mapId: `dungeon:${this.instanceId}` });
    pool.query('SELECT 1 FROM battle_logs WHERE result IS NULL AND dungeon_instance_id IS NOT NULL AND participants @> ARRAY[$1]::uuid[]', [a.characterId])
      .then((r) => { if (r.rowCount) hub.setBattle(a.characterId, true); this.pingPresence(); }).catch(() => {});
  }
  setInBattle() { this.pingPresence(); }
  private async move(client: Client, m: any) {
    const a = client.auth as Auth, p = this.state.players.get(client.sessionId); if (!a || !p) return;
    if (this.busy.get(client.sessionId)) { this.pending.set(client.sessionId, m); return; }
    this.busy.set(client.sessionId, true);
    try {
      let next = m;
      while (next) {
        this.pending.delete(client.sessionId);
        if (FACINGS.has(next?.facing)) p.facing = next.facing; p.moving = !!next?.moving;
        const r: any = await updateDungeonPosition(a.userId, a.characterId, { x: next?.x, y: next?.y }).catch(() => ({ ok: false, pos: { x: p.x, y: p.y } }));
        if (r.pos) { p.x = r.pos.x; p.y = r.pos.y; }
        if (r.mapId) this.state.mapId = r.mapId;
        if (!r.ok) client.send('correct', { reason: r.reason ?? 'invalid', pos: r.pos });
        next = this.pending.get(client.sessionId);
      }
    } finally { this.busy.set(client.sessionId, false); }
  }
  private async chat(client: Client, m: any) {
    const a = client.auth as Auth; if (!a) return;
    const r = await postChat({ id: a.characterId, name: a.name }, `dungeon:${this.instanceId}`, m?.channel, m?.body, m?.to).catch(() => ({ error: 'internal' } as any));
    if ('error' in r) return client.send('chat_error', { code: r.error, channel: m?.channel });
    if (r.to) hub.send(r.to, 'chat', r.msg); else this.broadcast('chat', r.msg, { except: this.clients.filter((x) => r.exclude?.includes((x.auth as any)?.characterId)) });
  }
  async onLeave(client: Client, consented: boolean) {
    const a = client.auth as Auth;
    const p = this.state.players.get(client.sessionId);
    if (a && !consented && !this.kicked.delete(client.sessionId)) {
      try { const nc = await this.allowReconnection(client, RECONNECT_SEC); hub.set(a.characterId, { client: nc, room: this, mapId: `dungeon:${this.instanceId}` }); this.pingPresence(); return; } catch { /* timed out */ }
    }
    if (a) { hub.setBattleReady(a.characterId, false); hub.remove(a.characterId, client); }
    this.state.players.delete(client.sessionId); this.busy.delete(client.sessionId); this.pending.delete(client.sessionId);
    this.pingPresence();
  }
  onDispose() { dungeonRoomReg.delete(this.instanceId); }
}
