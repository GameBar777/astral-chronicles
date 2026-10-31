/** PHASE 8 dungeon master data (server authoritative; client uses it only for labels). */
export interface DungeonFloor { name: string; enemies?: string[]; boss?: string; chest?: { gold: number; items: { itemId: string; qty: number }[] } }
export interface DungeonDef { id: string; name: string; entryMap: string; entrance: string; maxParty: number; ttlMin: number; floors: DungeonFloor[];
  clearReward: { gold: number; exp: number; items: { itemId: string; qty: number }[] } }
export const DUNGEONS: Record<string, DungeonDef> = {
  ancient_ruins: {
    id: 'ancient_ruins', name: '古代地下遺跡', entryMap: 'green_meadow', entrance: 'ruins_entrance', maxParty: 4, ttlMin: 60,
    floors: [
      { name: '地下1階 崩れた回廊', enemies: ['ruins_bat', 'ruins_skeleton'], chest: { gold: 40, items: [{ itemId: 'potion_small', qty: 2 }] } },
      { name: '地下2階 封印の間', enemies: ['ruins_skeleton', 'ruins_skeleton', 'ruins_bat'], chest: { gold: 60, items: [{ itemId: 'ether_small', qty: 1 }, { itemId: 'iron_ore', qty: 2 }] } },
      { name: '最深部 守護者の祭壇', boss: 'ruins_golem' },
    ],
    clearReward: { gold: 300, exp: 150, items: [{ itemId: 'magic_stone', qty: 2 }, { itemId: 'silver_ore', qty: 2 }] },
  },
};
