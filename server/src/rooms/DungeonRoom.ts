import { Room, type Client, ServerError } from 'colyseus';
import { pool } from '../db/pool.js';
import { resolveSession } from '../services/auth.js';
import { hub } from './hub.js';
import { postChat } from '../services/social.js';
import { RECONNECT_SEC } from './WorldRoom.js';
/**
 * PHASE 8 instance channel (one room per dungeon instance, filterBy instanceId). Carries presence and pushes only:
 * the authoritative dungeon/battle state lives in Postgres and is read via REST (`dungeon`/`battle` messages say "refresh"/carry the view).
 */
type Auth = { userId: string; characterId: string; name: string };
export class DungeonRoom extends Room {
  maxClients = 4;
  private instanceId = '';
  private kicked = new Set<string>();
  onCreate(opts: { instanceId: string }) {
    this.instanceId = String(opts.instanceId ?? '');
    this.onMessage('chat', (client, m) => this.chat(client, m));
  }
  async onAuth(_c: Client, opts: { token?: string; characterId?: string; instanceId?: string }) {
    const s = await resolveSession(opts?.token); if (!s) throw new ServerError(401, 'unauthorized');
    const r = await pool.query(`SELECT c.id,c.name FROM characters c JOIN dungeon_members m ON m.character_id=c.id AND m.left_at IS NULL
      WHERE c.id::text=$1 AND c.user_id=$2 AND c.deleted_at IS NULL AND m.instance_id::text=$3`, [String(opts?.characterId ?? ''), s.userId, this.instanceId]);
    if (!r.rows[0]) throw new ServerError(403, 'not_member');
    return { userId: s.userId, characterId: r.rows[0].id, name: r.rows[0].name } satisfies Auth;
  }
  private ids() { return this.clients.map((c) => (c.auth as Auth)?.characterId).filter(Boolean); }
  private pingPresence() { this.broadcast('dungeon', { type: 'presence' }); }
  onJoin(client: Client, _o: unknown, a: Auth) {
    for (const o of this.clients) if (o !== client && (o.auth as Auth)?.characterId === a.characterId) { this.kicked.add(o.sessionId); o.leave(4001, 'duplicate_login'); }
    hub.set(a.characterId, { client, room: this, mapId: `dungeon:${this.instanceId}` });
    pool.query('SELECT 1 FROM battle_logs WHERE result IS NULL AND dungeon_instance_id IS NOT NULL AND participants @> ARRAY[$1]::uuid[]', [a.characterId])
      .then((r) => { if (r.rowCount) hub.setBattle(a.characterId, true); this.pingPresence(); }).catch(() => {});
  }
  setInBattle() { this.pingPresence(); }
  private async chat(client: Client, m: any) {
    const a = client.auth as Auth; if (!a) return;
    const r = await postChat({ id: a.characterId, name: a.name }, `dungeon:${this.instanceId}`, m?.channel, m?.body).catch(() => ({ error: 'internal' } as any));
    if ('error' in r) return client.send('chat_error', { code: r.error, channel: m?.channel });
    if (r.to) hub.send(r.to, 'chat', r.msg); else this.broadcast('chat', r.msg);
  }
  async onLeave(client: Client, consented: boolean) {
    const a = client.auth as Auth;
    if (a && !consented && !this.kicked.delete(client.sessionId)) {
      try { const nc = await this.allowReconnection(client, RECONNECT_SEC); hub.set(a.characterId, { client: nc, room: this, mapId: `dungeon:${this.instanceId}` }); this.pingPresence(); return; } catch { /* timed out */ }
    }
    if (a) hub.remove(a.characterId, client);
    this.pingPresence();
  }
}
