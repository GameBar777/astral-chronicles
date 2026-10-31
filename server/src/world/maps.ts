import { readFileSync, readdirSync } from 'node:fs';
import type { MapData } from '@astral/shared';
/** Server keeps its own copy of every map (collision, portals, NPCs, gather nodes) — the client is never trusted for these. */
const DIR = new URL('../../../assets/maps/', import.meta.url);
export const MAPS: Record<string, MapData> = Object.fromEntries(readdirSync(DIR).filter((f) => f.endsWith('.json'))
  .map((f) => { const m = JSON.parse(readFileSync(new URL(f, DIR), 'utf8')) as MapData; return [m.id, m]; }));
export const TOWN = 'asteria';
export const npcPos = (mapId: string, npcId: string) => MAPS[mapId]?.objects.find((o) => o.type === 'npc' && o.id === npcId);
