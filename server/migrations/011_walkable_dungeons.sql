-- Walkable multi-room dungeons + the remaining four planned dungeons, and per-member in-dungeon positions.

ALTER TABLE dungeon_members
  ADD COLUMN IF NOT EXISTS pos_x int,
  ADD COLUMN IF NOT EXISTS pos_y int,
  ADD COLUMN IF NOT EXISTS pos_updated_at timestamptz;

INSERT INTO monster_definitions (id,name,level,hp,mp,atk,def,matk,mdef,agi,exp_reward,gold_reward,element,behavior,spawn_areas,spawn_rate,is_boss) VALUES
 -- forgotten mine
 ('mine_slimebat','坑道コウモリ',6,36,0,15,5,7,5,16,22,12,'dark','{"actions":[{"kind":"attack","weight":3},{"kind":"skill","weight":1,"name":"超音波","mult":0.6,"inflict":{"status":"confusion","rate":0.25}}]}','{forgotten_mine}',0.5,false),
 ('mine_beetle','坑道カブト',7,52,0,18,12,4,8,6,28,16,'earth','{"actions":[{"kind":"attack","weight":3},{"kind":"skill","weight":1,"name":"突進","mult":1.3}]}','{forgotten_mine}',0.5,false),
 ('mine_goblin','坑夫ゴブリン',8,60,8,20,8,6,6,10,34,20,'dark','{"actions":[{"kind":"attack","weight":3},{"kind":"skill","weight":1,"name":"ツルハシ","mult":1.4}]}','{forgotten_mine}',0.4,false),
 ('mine_golem','鉱山ゴーレム',12,420,40,24,16,10,10,5,180,120,'earth',
  '{"actions":[{"kind":"attack","weight":3},{"kind":"skill","weight":1,"name":"落盤","mult":0.85,"aoe":true}],
    "phases":[
      {"at":0.55,"name":"覚醒","text":"ゴーレムが鉱脈を喰らい体を硬くした！（フェーズ2）","atkMul":1.2,"defMul":1.15,
       "actions":[{"kind":"attack","weight":2},{"kind":"skill","weight":2,"name":"落盤","mult":1.0,"aoe":true},{"kind":"skill","weight":1,"name":"岩石投げ","mult":1.3}]},
      {"at":0.25,"name":"崩壊","text":"鉱山が軋み、ゴーレムが暴走を始めた！（フェーズ3）","atkMul":1.3,"defMul":0.7,
       "actions":[{"kind":"skill","weight":2,"name":"崩壊の拳","mult":1.6},{"kind":"skill","weight":2,"name":"落盤","mult":1.1,"aoe":true}]}
    ]}','{forgotten_mine}',0,true),
 -- dark forest
 ('forest_wisp','霧のウィスプ',9,40,30,12,6,18,12,14,30,16,'dark','{"actions":[{"kind":"attack","weight":2},{"kind":"skill","weight":2,"name":"呪いの光","mult":1.1,"inflict":{"status":"atk_down","rate":0.3}}]}','{dark_forest}',0.5,false),
 ('forest_sapling','彷徨う若木',10,70,10,22,10,8,8,7,40,22,'earth','{"actions":[{"kind":"attack","weight":3},{"kind":"skill","weight":1,"name":"根縛り","mult":0.7,"inflict":{"status":"paralysis","rate":0.35}}]}','{dark_forest}',0.5,false),
 ('forest_treant','封印の大樹',16,560,60,28,16,20,14,6,260,160,'earth',
  '{"actions":[{"kind":"attack","weight":3},{"kind":"skill","weight":1,"name":"木霊","mult":0.9,"aoe":true}],
    "phases":[
      {"at":0.6,"name":"芽吹き","text":"大樹が無数の枝を伸ばした！（フェーズ2：全体攻撃）","atkMul":1.15,
       "actions":[{"kind":"attack","weight":1},{"kind":"skill","weight":3,"name":"木霊","mult":1.0,"aoe":true},{"kind":"skill","weight":1,"name":"根縛り","mult":0.8,"inflict":{"status":"paralysis","rate":0.4}}]},
      {"at":0.3,"name":"古代の怒り","text":"封印が解け、大樹が咆哮する！（フェーズ3）","atkMul":1.3,"defMul":0.8,
       "actions":[{"kind":"skill","weight":2,"name":"古木の一撃","mult":1.7},{"kind":"skill","weight":2,"name":"木霊","mult":1.15,"aoe":true}]}
    ]}','{dark_forest}',0,true),
 -- desert temple
 ('desert_scarab','砂のスカラベ',13,64,0,24,14,8,10,12,44,24,'earth','{"actions":[{"kind":"attack","weight":3},{"kind":"skill","weight":1,"name":"砂塵","mult":0.7,"aoe":true}]}','{desert_temple}',0.5,false),
 ('desert_mummy','神殿のミイラ',14,88,16,26,12,16,14,8,52,28,'dark','{"actions":[{"kind":"attack","weight":2},{"kind":"skill","weight":2,"name":"包帯","mult":1.2,"inflict":{"status":"poison","rate":0.3}}]}','{desert_temple}',0.5,false),
 ('desert_sphinx','砂漠のスフィンクス',20,720,80,32,18,26,18,10,340,200,'light',
  '{"actions":[{"kind":"attack","weight":2},{"kind":"skill","weight":2,"name":"謎かけの風","mult":1.0,"aoe":true}],
    "phases":[
      {"at":0.65,"name":"審判","text":"スフィンクスの目が金色に輝いた！（フェーズ2）","atkMul":1.2,
       "actions":[{"kind":"attack","weight":1},{"kind":"skill","weight":2,"name":"謎かけの風","mult":1.15,"aoe":true},{"kind":"skill","weight":2,"name":"砂嵐","mult":1.3,"inflict":{"status":"def_down","rate":0.35}}]},
      {"at":0.3,"name":"神罰","text":"神殿が震え、スフィンクスが神罰を下す！（フェーズ3）","atkMul":1.35,"defMul":0.85,
       "actions":[{"kind":"skill","weight":2,"name":"神罰","mult":1.8},{"kind":"skill","weight":2,"name":"砂嵐","mult":1.2,"aoe":true}]}
    ]}','{desert_temple}',0,true),
 -- star tower
 ('tower_shard','星晶の欠片',17,80,24,22,10,28,16,14,60,30,'light','{"actions":[{"kind":"attack","weight":2},{"kind":"skill","weight":2,"name":"星屑","mult":1.15}]}','{star_tower}',0.55,false),
 ('tower_sentinel','星晶の番人',24,880,100,36,20,32,22,12,420,260,'light',
  '{"actions":[{"kind":"attack","weight":2},{"kind":"skill","weight":2,"name":"星屑の槍","mult":1.2}],
    "phases":[
      {"at":0.6,"name":"共鳴","text":"塔の結界が共鳴し、番人の魔力が高まった！（フェーズ2）","atkMul":1.25,
       "actions":[{"kind":"attack","weight":1},{"kind":"skill","weight":2,"name":"星屑の槍","mult":1.35},{"kind":"skill","weight":2,"name":"流星","mult":1.0,"aoe":true}]},
      {"at":0.28,"name":"星降り","text":"天から星が降り注ぐ！（フェーズ3）","atkMul":1.4,"defMul":0.8,
       "actions":[{"kind":"skill","weight":2,"name":"流星","mult":1.25,"aoe":true},{"kind":"skill","weight":2,"name":"星晶爆","mult":1.9}]}
    ]}','{star_tower}',0,true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO monster_drops (monster_id,item_id,drop_rate,min_qty,max_qty) VALUES
 ('mine_slimebat','beast_hide',0.35,1,1),('mine_beetle','copper_ore',0.45,1,2),('mine_goblin','iron_ore',0.4,1,2),('mine_goblin','potion_small',0.15,1,1),
 ('mine_golem','iron_ore',1.0,2,3),('mine_golem','silver_ore',0.6,1,2),
 ('forest_wisp','herb',0.4,1,2),('forest_sapling','wood',0.5,1,2),('forest_treant','wood',1.0,3,5),('forest_treant','magic_stone',0.7,1,2),
 ('desert_scarab','copper_ore',0.35,1,2),('desert_mummy','ether_small',0.25,1,1),('desert_sphinx','magic_stone',1.0,2,3),('desert_sphinx','silver_ore',0.7,1,2),
 ('tower_shard','magic_stone',0.4,1,1),('tower_sentinel','magic_stone',1.0,3,4),('tower_sentinel','silver_ore',0.8,2,3)
ON CONFLICT DO NOTHING;
