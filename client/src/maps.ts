import type { MapData } from '@astral/shared';
const modules = import.meta.glob('../../assets/maps/*.json', { eager: true, import: 'default' }) as Record<string, MapData>;
export const MAPS: Record<string, MapData> = Object.fromEntries(Object.values(modules).map((m) => [m.id, m]));
export const mapOf = (id: string) => MAPS[id];
