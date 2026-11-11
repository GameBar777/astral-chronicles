import type { Client } from 'colyseus';
/**
 * PHASE 7 in-process presence registry: characterId -> live room connection. Lets REST handlers and rooms push to a
 * character wherever they are (party/guild chat across maps, social refresh, in-battle flag). Single process only (TD-015).
 */
export type Seat = { client: Client; room: { setInBattle(sessionId: string, v: boolean): void; state: any }; mapId: string };
const seats = new Map<string, Seat>();
const battle = new Set<string>();
const ready = new Set<string>(); // BattleScene is up and accepting commands (BUG-023)
export const hub = {
  set(characterId: string, s: Seat) { if (process.env.DUNGEON_DEBUG === '1') console.log('[hub] set', characterId.slice(0, 4), s.mapId, 'prev', seats.get(characterId)?.mapId ?? '-'); seats.set(characterId, s); },
  remove(characterId: string, client: Client) { const hit = seats.get(characterId)?.client === client; if (process.env.DUNGEON_DEBUG === '1') console.log('[hub] remove', characterId.slice(0, 4), hit ? 'removed' : 'stale(no-op)', seats.get(characterId)?.mapId ?? '-'); if (hit) seats.delete(characterId); },
  online: (characterId: string) => seats.has(characterId),
  mapOf: (characterId: string) => seats.get(characterId)?.mapId ?? null,
  inBattle: (characterId: string) => battle.has(characterId),
  /** true only after the client sent battle_ready (Battle scene is live). */
  battleReady: (characterId: string) => ready.has(characterId),
  setBattleReady(characterId: string, v: boolean) { if (v) ready.add(characterId); else ready.delete(characterId); },
  send(characterIds: Iterable<string>, type: string, msg: unknown) { for (const id of characterIds) seats.get(id)?.client.send(type, msg); },
  setBattle(characterId: string, v: boolean) {
    if (v) battle.add(characterId); else { battle.delete(characterId); ready.delete(characterId); }
    const s = seats.get(characterId); s?.room.setInBattle(s.client.sessionId, v);
    onBattle?.(characterId, v);
  },
  clear() { seats.clear(); battle.clear(); ready.clear(); },
  onlineIds() { return [...seats.keys()]; },
  /** force-disconnect (ban / maintenance) */
  kick(characterIds: Iterable<string>, reason: string) { for (const id of characterIds) { const s = seats.get(id); if (s) { s.client.send('system_notice', { type: reason }); s.client.leave(4003, reason); seats.delete(id); } } },
};
let onBattle: ((id: string, v: boolean) => void) | undefined;
export const onBattleChange = (f: typeof onBattle) => { onBattle = f; };
