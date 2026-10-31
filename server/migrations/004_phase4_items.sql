-- PHASE 4: items, equipment, inventory, gathering, crafting, enhancement, server-side position (SECTION 10-12)
ALTER TABLE transactions ADD COLUMN result jsonb;            -- cached response for idempotent replay of a requestId
ALTER TABLE characters ADD COLUMN pos_updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE character_stats ADD COLUMN gathering_exp jsonb NOT NULL DEFAULT '{"mining":0,"logging":0,"herb":0,"monster":0}';

INSERT INTO item_definitions (id, name, category, rarity, stackable, max_stack, sell_price, buy_price, effect, description) VALUES
 ('wooden_sword','木の剣','equipment','normal',false,1,5,40,'{}','練習用の木剣'),
 ('copper_sword','銅の剣','equipment','normal',false,1,30,150,'{}','銅を鍛えた片手剣'),
 ('iron_sword','鉄の剣','equipment','rare',false,1,90,NULL,'{}','よく鍛えられた鉄の片手剣'),
 ('oak_staff','樫の杖','equipment','normal',false,1,5,40,'{}','魔力を通しやすい樫の杖'),
 ('copper_dagger','銅の短剣','equipment','normal',false,1,25,120,'{}','軽くて扱いやすい短剣'),
 ('wooden_shield','木の盾','equipment','normal',false,1,10,60,'{}','木の板を組んだ丸盾'),
 ('leather_cap','革の帽子','equipment','normal',false,1,8,50,'{}','なめし革の帽子'),
 ('iron_helm','鉄の兜','equipment','rare',false,1,60,NULL,'{}','頭を守る鉄の兜'),
 ('leather_armor','革の鎧','equipment','normal',false,1,15,90,'{}','動きやすい革鎧'),
 ('iron_armor','鉄の鎧','equipment','rare',false,1,110,NULL,'{}','重いが頑丈な鉄鎧'),
 ('leather_gloves','革の手袋','equipment','normal',false,1,8,45,'{}','手を守る革手袋'),
 ('leather_boots','革のブーツ','equipment','normal',false,1,8,45,'{}','歩きやすい革靴'),
 ('copper_ring','銅の指輪','equipment','rare',false,1,40,NULL,'{}','赤い石がはまった指輪。魔力が少し上がる'),
 ('wood','木材','material','normal',true,99,2,NULL,'{}','伐採で得られる木材'),
 ('fine_wood','上質木材','material','normal',true,99,8,NULL,'{}','木目の詰まった上質な木材'),
 ('copper_ore','銅鉱石','material','normal',true,99,3,NULL,'{}','赤茶色の鉱石'),
 ('iron_ore','鉄鉱石','material','normal',true,99,8,NULL,'{}','重い灰色の鉱石'),
 ('silver_ore','銀鉱石','material','rare',true,99,20,NULL,'{}','白く輝く鉱石'),
 ('herb','薬草','material','normal',true,99,2,NULL,'{}','やくそうの材料'),
 ('high_herb','高級薬草','material','rare',true,99,10,NULL,'{}','効き目の強い薬草'),
 ('beast_hide','獣皮','material','normal',true,99,5,NULL,'{}','なめす前の獣の皮'),
 ('magic_stone','魔石','material','rare',true,99,25,NULL,'{}','魔力を帯びた石'),
 ('ether_small','まほうの水','consumable','normal',true,99,10,30,'{"mp":20}','MPを20回復する');
UPDATE item_definitions SET effect='{"heal":30}' WHERE id='potion_small';

INSERT INTO equipment_definitions (item_id, slot_category, level_req, class_restrict, atk, def, matk, mdef, special_effect, craft_materials, obtain_from) VALUES
 ('wooden_sword','one_hand_sword',1,'{}',4,0,0,0,'{}','[]','初期装備・ショップ'),
 ('copper_sword','one_hand_sword',2,'{}',9,0,0,0,'{}','[{"itemId":"copper_ore","qty":4},{"itemId":"wood","qty":1}]','製作・ショップ'),
 ('iron_sword','one_hand_sword',5,'{}',16,0,0,0,'{}','[{"itemId":"iron_ore","qty":5},{"itemId":"fine_wood","qty":1}]','製作'),
 ('oak_staff','staff',1,'{}',1,0,5,1,'{}','[]','初期装備・ショップ'),
 ('copper_dagger','dagger',1,'{}',6,0,0,0,'{"critBonus":0.03}','[{"itemId":"copper_ore","qty":3}]','製作・ショップ'),
 ('wooden_shield','shield',1,'{}',0,3,0,1,'{}','[{"itemId":"wood","qty":3}]','初期装備(騎士)・ショップ'),
 ('leather_cap','head',1,'{}',0,2,0,1,'{}','[{"itemId":"beast_hide","qty":1}]','製作・ショップ'),
 ('iron_helm','head',4,'{warrior,knight}',0,6,0,2,'{}','[{"itemId":"iron_ore","qty":3}]','製作'),
 ('leather_armor','body',1,'{}',0,4,0,2,'{}','[{"itemId":"beast_hide","qty":2}]','製作・ショップ'),
 ('iron_armor','body',5,'{warrior,knight}',0,10,0,3,'{}','[{"itemId":"iron_ore","qty":6},{"itemId":"beast_hide","qty":1}]','製作'),
 ('leather_gloves','arms',1,'{}',1,1,0,0,'{}','[{"itemId":"beast_hide","qty":1}]','製作・ショップ'),
 ('leather_boots','legs',1,'{}',0,2,0,0,'{}','[{"itemId":"beast_hide","qty":1}]','製作・ショップ'),
 ('copper_ring','accessory',2,'{}',0,0,3,2,'{}','[{"itemId":"copper_ore","qty":2},{"itemId":"magic_stone","qty":1}]','製作');

-- monster material drops (SECTION 12 モンスター素材収集)
INSERT INTO monster_drops (monster_id, item_id, drop_rate, min_qty, max_qty) VALUES
 ('horn_rabbit','beast_hide',0.4,1,1), ('wild_dog','beast_hide',0.5,1,2), ('goblin','copper_ore',0.35,1,2), ('mushroom','herb',0.3,1,2), ('goblin','magic_stone',0.05,1,1);

-- recipes (SECTION 12: materials, required level, craft time, cost)
INSERT INTO recipes (id, category, result_item_id, result_qty, materials, required_level, craft_time_sec, gold_cost) VALUES
 ('r_potion_small','alchemy','potion_small',2,'[{"itemId":"herb","qty":2}]',1,2,0),
 ('r_ether_small','alchemy','ether_small',1,'[{"itemId":"herb","qty":1},{"itemId":"slime_jelly","qty":2}]',1,3,5),
 ('r_antidote','alchemy','antidote',1,'[{"itemId":"herb","qty":1},{"itemId":"mushroom_cap","qty":1}]',1,2,0),
 ('r_copper_sword','weapon','copper_sword',1,'[{"itemId":"copper_ore","qty":4},{"itemId":"wood","qty":1}]',2,4,30),
 ('r_copper_dagger','weapon','copper_dagger',1,'[{"itemId":"copper_ore","qty":3}]',1,3,20),
 ('r_iron_sword','weapon','iron_sword',1,'[{"itemId":"iron_ore","qty":5},{"itemId":"fine_wood","qty":1}]',5,6,120),
 ('r_wooden_shield','armor','wooden_shield',1,'[{"itemId":"wood","qty":3}]',1,3,10),
 ('r_leather_cap','armor','leather_cap',1,'[{"itemId":"beast_hide","qty":1}]',1,3,10),
 ('r_leather_armor','armor','leather_armor',1,'[{"itemId":"beast_hide","qty":2}]',1,4,20),
 ('r_leather_gloves','armor','leather_gloves',1,'[{"itemId":"beast_hide","qty":1}]',1,3,10),
 ('r_leather_boots','armor','leather_boots',1,'[{"itemId":"beast_hide","qty":1}]',1,3,10),
 ('r_iron_helm','armor','iron_helm',1,'[{"itemId":"iron_ore","qty":3}]',4,5,60),
 ('r_iron_armor','armor','iron_armor',1,'[{"itemId":"iron_ore","qty":6},{"itemId":"beast_hide","qty":1}]',5,6,150),
 ('r_copper_ring','accessory','copper_ring',1,'[{"itemId":"copper_ore","qty":2},{"itemId":"magic_stone","qty":1}]',2,5,50);

-- gathering nodes (positions = assets/maps/green_meadow.json objects type 'gather'; pixel x / footprint bottom y)
-- loot_table: [{itemId, weight, minLevel, min, max}]; minLevel = 採集レベル解放
INSERT INTO gathering_nodes (id, map_id, type, pos_x, pos_y, required_level, loot_table, respawn_sec) VALUES
 ('node_copper_1','green_meadow','mining',400,800,1,'[{"itemId":"copper_ore","weight":80,"minLevel":1,"min":1,"max":2},{"itemId":"iron_ore","weight":20,"minLevel":3,"min":1,"max":1},{"itemId":"magic_stone","weight":4,"minLevel":5,"min":1,"max":1}]',30),
 ('node_copper_2','green_meadow','mining',912,992,1,'[{"itemId":"copper_ore","weight":80,"minLevel":1,"min":1,"max":2},{"itemId":"iron_ore","weight":20,"minLevel":3,"min":1,"max":1}]',30),
 ('node_iron_1','green_meadow','mining',1424,736,2,'[{"itemId":"iron_ore","weight":70,"minLevel":2,"min":1,"max":2},{"itemId":"silver_ore","weight":10,"minLevel":6,"min":1,"max":1},{"itemId":"magic_stone","weight":6,"minLevel":4,"min":1,"max":1}]',45),
 ('node_wood_1','green_meadow','logging',656,864,1,'[{"itemId":"wood","weight":85,"minLevel":1,"min":1,"max":3},{"itemId":"fine_wood","weight":15,"minLevel":3,"min":1,"max":1}]',30),
 ('node_wood_2','green_meadow','logging',1296,320,1,'[{"itemId":"wood","weight":85,"minLevel":1,"min":1,"max":3},{"itemId":"fine_wood","weight":15,"minLevel":3,"min":1,"max":1}]',30),
 ('node_herb_1','green_meadow','herb',336,352,1,'[{"itemId":"herb","weight":85,"minLevel":1,"min":1,"max":2},{"itemId":"high_herb","weight":15,"minLevel":4,"min":1,"max":1}]',25),
 ('node_herb_2','green_meadow','herb',784,704,1,'[{"itemId":"herb","weight":85,"minLevel":1,"min":1,"max":2},{"itemId":"high_herb","weight":15,"minLevel":4,"min":1,"max":1}]',25),
 ('node_herb_3','green_meadow','herb',1424,928,1,'[{"itemId":"herb","weight":85,"minLevel":1,"min":1,"max":2},{"itemId":"high_herb","weight":15,"minLevel":4,"min":1,"max":1}]',25);

-- per-character node respawn (solo world until PHASE 6 shared sync)
CREATE TABLE gather_node_state (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES gathering_nodes(id),
  available_at timestamptz NOT NULL,
  PRIMARY KEY (character_id, node_id)
);
CREATE TABLE crafting_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  recipe_id text NOT NULL REFERENCES recipes(id),
  ready_at timestamptz NOT NULL, claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_crafting_one_active ON crafting_jobs(character_id) WHERE claimed_at IS NULL;  -- 1 job at a time

-- backfill: existing characters get starter weapon (equipped) and potions if they have none
INSERT INTO inventory (character_id, item_id, quantity)
  SELECT c.id, CASE c.class WHEN 'mage' THEN 'oak_staff' WHEN 'priest' THEN 'oak_staff' ELSE 'wooden_sword' END, 1 FROM characters c;
INSERT INTO character_equipment (character_id, slot, inventory_id)
  SELECT i.character_id, 'weapon', i.id FROM inventory i WHERE i.item_id IN ('wooden_sword','oak_staff') ON CONFLICT DO NOTHING;
INSERT INTO inventory (character_id, item_id, quantity)
  SELECT c.id, 'potion_small', 3 FROM characters c WHERE NOT EXISTS (SELECT 1 FROM inventory i WHERE i.character_id=c.id AND i.item_id='potion_small');
