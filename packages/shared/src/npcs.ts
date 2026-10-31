// PHASE 5 NPC dialogue + services. Positions live in assets/maps/asteria.json (server reads them for range checks).
export type NpcService = 'shop' | 'inn' | 'smith' | 'quest';
export const NPC_RANGE = 80;
export const INN_COST_PER_LEVEL = 10;
export const innCost = (level: number) => INN_COST_PER_LEVEL * level;
export const NPCS: Record<string, { name: string; lines: string[]; services: NpcService[] }> = {
  npc_guild_receptionist: { name: 'ギルド受付 ミーナ', lines: ['冒険者ギルドへようこそ！', 'ギルド機能はまだ準備中なの。ごめんなさいね。'], services: [] },
  npc_guard_leon: { name: '衛兵 レオン', lines: ['東の門の先は「みどりの草原」だ。', '腕に覚えがあるなら、毎日の見回りを手伝ってくれ。'], services: ['quest'] },
  npc_traveler_aria: { name: '旅人 アリア', lines: ['この街の噴水、きれいでしょう？', '草原の奥には鉄鉱石が眠っているらしいわ。'], services: [] },
  npc_smith_gord: { name: '鍛冶屋 ゴルド', lines: ['何を打とうか？'], services: ['smith', 'quest'] },
  npc_shop_mira: { name: '道具屋 ミラ', lines: ['いらっしゃいませ！旅の準備はここで。'], services: ['shop', 'quest'] },
  npc_inn_hana: { name: '宿屋 ハナ', lines: ['お疲れさま。ひと晩休んでいく？'], services: ['inn'] },
  npc_chief_bram: { name: '村長 ブラム', lines: ['アステリアへようこそ、若き冒険者よ。', '困りごとがあれば聞いてくれんか。'], services: ['quest'] },
};
export type QuestObjective = { type: 'kill'; monsterId: string; qty: number } | { type: 'collect'; itemId: string; qty: number } | { type: 'deliver'; itemId: string; npcId: string };
