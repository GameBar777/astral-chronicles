/** Dungeon master data (server authoritative; client uses it only for labels and map ids). */
export interface DungeonFloor { name: string; mapId: string; enemies?: string[]; boss?: string; chest?: { gold: number; items: { itemId: string; qty: number }[] } }
/** recommendedLevel: shown on entry; minLevel: every entering member must meet it; reentryCooldownMin: after a clear, the same character waits this long before entering again */
export interface DungeonDef { id: string; name: string; entryMap: string; entrance: string; maxParty: number; ttlMin: number; floors: DungeonFloor[];
  recommendedLevel: number; minLevel: number; reentryCooldownMin: number;
  backdrop: string;
  clearReward: { gold: number; exp: number; items: { itemId: string; qty: number }[] } }
export const DUNGEONS: Record<string, DungeonDef> = {
  ancient_ruins: {
    id: 'ancient_ruins', name: '古代地下遺跡', entryMap: 'green_meadow', entrance: 'ruins_entrance', maxParty: 4, ttlMin: 60, recommendedLevel: 5, minLevel: 1, reentryCooldownMin: 10,
    backdrop: 'battle_ruins',
    floors: [
      { name: '地下1階 崩れた回廊', mapId: 'dg_ancient_ruins_1', enemies: ['ruins_bat', 'ruins_skeleton'], chest: { gold: 40, items: [{ itemId: 'potion_small', qty: 2 }] } },
      { name: '地下2階 封印の間', mapId: 'dg_ancient_ruins_2', enemies: ['ruins_skeleton', 'ruins_skeleton', 'ruins_bat'], chest: { gold: 60, items: [{ itemId: 'ether_small', qty: 1 }, { itemId: 'iron_ore', qty: 2 }] } },
      { name: '最深部 守護者の祭壇', mapId: 'dg_ancient_ruins_3', boss: 'ruins_golem' },
    ],
    clearReward: { gold: 300, exp: 150, items: [{ itemId: 'magic_stone', qty: 2 }, { itemId: 'silver_ore', qty: 2 }] },
  },
  forgotten_mine: {
    id: 'forgotten_mine', name: '忘れられた鉱山', entryMap: 'green_meadow', entrance: 'mine_entrance', maxParty: 4, ttlMin: 60, recommendedLevel: 8, minLevel: 3, reentryCooldownMin: 10,
    backdrop: 'battle_mine',
    floors: [
      { name: '坑道1 廃れた採掘場', mapId: 'dg_forgotten_mine_1', enemies: ['mine_slimebat', 'mine_beetle'], chest: { gold: 50, items: [{ itemId: 'potion_small', qty: 2 }, { itemId: 'copper_ore', qty: 2 }] } },
      { name: '坑道2 崩落した縦坑', mapId: 'dg_forgotten_mine_2', enemies: ['mine_goblin', 'mine_beetle', 'mine_goblin'], chest: { gold: 80, items: [{ itemId: 'ether_small', qty: 1 }, { itemId: 'iron_ore', qty: 3 }] } },
      { name: '最深部 岩石の守護者', mapId: 'dg_forgotten_mine_3', boss: 'mine_golem' },
    ],
    clearReward: { gold: 400, exp: 220, items: [{ itemId: 'iron_ore', qty: 4 }, { itemId: 'silver_ore', qty: 2 }] },
  },
  dark_forest: {
    id: 'dark_forest', name: '闇の森林', entryMap: 'green_meadow', entrance: 'forest_entrance', maxParty: 4, ttlMin: 60, recommendedLevel: 12, minLevel: 6, reentryCooldownMin: 15,
    backdrop: 'battle_darkforest',
    floors: [
      { name: '森の入口 霧の小径', mapId: 'dg_dark_forest_1', enemies: ['forest_wisp', 'forest_sapling'], chest: { gold: 70, items: [{ itemId: 'potion_small', qty: 3 }, { itemId: 'herb', qty: 3 }] } },
      { name: '中層 古木の広場', mapId: 'dg_dark_forest_2', enemies: ['forest_sapling', 'forest_wisp', 'forest_sapling'], chest: { gold: 100, items: [{ itemId: 'ether_small', qty: 2 }, { itemId: 'wood', qty: 4 }] } },
      { name: '奥地 封印の大樹', mapId: 'dg_dark_forest_3', boss: 'forest_treant' },
    ],
    clearReward: { gold: 520, exp: 300, items: [{ itemId: 'magic_stone', qty: 3 }, { itemId: 'wood', qty: 5 }] },
  },
  desert_temple: {
    id: 'desert_temple', name: '砂漠の神殿', entryMap: 'green_meadow', entrance: 'temple_entrance', maxParty: 4, ttlMin: 75, recommendedLevel: 16, minLevel: 10, reentryCooldownMin: 15,
    backdrop: 'battle_desert',
    floors: [
      { name: '神殿1 熱砂の回廊', mapId: 'dg_desert_temple_1', enemies: ['desert_scarab', 'desert_mummy'], chest: { gold: 90, items: [{ itemId: 'potion_small', qty: 1 }, { itemId: 'ether_small', qty: 1 }] } },
      { name: '神殿2 壁画の間', mapId: 'dg_desert_temple_2', enemies: ['desert_mummy', 'desert_scarab', 'desert_mummy'], chest: { gold: 130, items: [{ itemId: 'ether_small', qty: 1 }, { itemId: 'silver_ore', qty: 2 }] } },
      { name: '最深部 砂漠の守護像', mapId: 'dg_desert_temple_3', boss: 'desert_sphinx' },
    ],
    clearReward: { gold: 700, exp: 400, items: [{ itemId: 'magic_stone', qty: 3 }, { itemId: 'silver_ore', qty: 3 }] },
  },
  star_tower: {
    id: 'star_tower', name: '星晶の塔', entryMap: 'green_meadow', entrance: 'tower_entrance', maxParty: 4, ttlMin: 90, recommendedLevel: 20, minLevel: 14, reentryCooldownMin: 20,
    backdrop: 'battle_tower',
    floors: [
      { name: '塔1 星屑の階段室', mapId: 'dg_star_tower_1', enemies: ['tower_shard', 'tower_shard'], chest: { gold: 120, items: [{ itemId: 'potion_small', qty: 2 }, { itemId: 'ether_small', qty: 1 }] } },
      { name: '塔2 水晶の回廊', mapId: 'dg_star_tower_2', enemies: ['tower_shard', 'tower_shard', 'tower_shard'], chest: { gold: 160, items: [{ itemId: 'ether_small', qty: 2 }, { itemId: 'magic_stone', qty: 2 }] } },
      { name: '最上部 星晶の間', mapId: 'dg_star_tower_3', boss: 'tower_sentinel' },
    ],
    clearReward: { gold: 900, exp: 550, items: [{ itemId: 'magic_stone', qty: 4 }, { itemId: 'silver_ore', qty: 4 }] },
  },
};
export const dungeonBackdrop = (dungeonId?: string | null) => DUNGEONS[dungeonId ?? '']?.backdrop ?? 'battle_meadow';
export const floorMapId = (dungeonId: string, floor: number) => DUNGEONS[dungeonId]?.floors[floor - 1]?.mapId;
