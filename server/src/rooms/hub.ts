import type { Client } from 'colyseus';
/**
 * PHASE 7 in-process presence registry: characterId -> live room connection. Lets REST handlers and rooms push to a
 * character wherever they are (party/guild chat across maps, social refresh, in-battle flag). Single process only (TD-015).
 */
export type Seat = { client: Client; room: { setInBattle(sessionId: string, v: boolean): void; state: any }; mapId: string };
const seats = new Map<string, Seat>();
const battle = new Set<string>();
export const hub = {
  set(characterId: string, s: Seat) { seats.set(characterId, s); },
  remove(characterId: string, client: Client) { if (seats.get(characterId)?.client === client) seats.delete(characterId); },
  online: (characterId: string) => seats.has(characterId),
  mapOf: (characterId: string) => seats.get(characterId)?.mapId ?? null,
  inBattle: (characterId: string) => battle.has(characterId),
  send(characterIds: Iterable<string>, type: string, msg: unknown) { for (const id of characterIds) seats.get(id)?.client.send(type, msg); },
  setBattle(characterId: string, v: boolean) {
    if (v) battle.add(characterId); else battle.delete(characterId);
    const s = seats.get(characterId); s?.room.setInBattle(s.client.sessionId, v);
    onBattle?.(characterId, v);
  },
  clear() { seats.clear(); battle.clear(); },
  onlineIds() { return [...seats.keys()]; },
  /** force-disconnect (ban / maintenance) */
  kick(characterIds: Iterable<string>, reason: string) { for (const id of characterIds) { const s = seats.get(id); if (s) { s.client.send('system_notice', { type: reason }); s.client.leave(4003, reason); seats.delete(id); } } },
};
let onBattle: ((id: string, v: boolean) => void) | undefined;
export const onBattleChange = (f: typeof onBattle) => { onBattle = f; };
