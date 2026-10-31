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
  objects: { id: string; type: 'npc' | 'portal' | 'gather' | 'chest' | 'deco'; x: number; y: number; props?: Record<string, unknown> }[];
}
