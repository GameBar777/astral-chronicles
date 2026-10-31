export type ClassId = 'warrior' | 'knight' | 'mage' | 'priest';
export type Rarity = 'normal' | 'rare' | 'epic' | 'legendary' | 'mythic';
export type Direction = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export interface Vec2 { x: number; y: number; }
export interface InputState { up: boolean; down: boolean; left: boolean; right: boolean; }
/** Tiled-compatible subset (orthogonal JSON export, layers: ground / collision / objects). */
export interface MapData {
  id: string; name: string; width: number; height: number; tilewidth: number; tileheight: number;
  recommendedLevel: [number, number];
  layers: { name: string; data: number[] }[];
  spawn: Vec2;
  projection?: 'orthogonal' | 'oblique_3_4';
  /** x,y = footprint bottom-center (pixel). Depth (Y-sort) uses y. tx/ty/fw/fh = footprint in tiles (collision). */
  objects: { id: string; type: 'npc' | 'portal' | 'gather' | 'chest' | 'deco' | 'spawn' | 'dungeon'; kind?: string; x: number; y: number;
    tx?: number; ty?: number; fw?: number; fh?: number; label?: string; props?: Record<string, unknown> }[];
}
