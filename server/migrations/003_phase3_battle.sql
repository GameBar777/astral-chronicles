-- PHASE 3: battle persistence (disconnect-safe), master data for green_meadow monsters/items
ALTER TABLE battle_logs ADD COLUMN character_id uuid REFERENCES characters(id) ON DELETE CASCADE,
  ADD COLUMN zone text, ADD COLUMN state jsonb, ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
-- at most one unfinished battle per character (reconnect resumes it; no parallel battles for reward farming)
CREATE UNIQUE INDEX ux_battle_logs_active ON battle_logs(character_id) WHERE result IS NULL;

INSERT INTO item_definitions (id, name, category, rarity, sell_price, buy_price, effect, description) VALUES
 ('potion_small','やくそう','consumable','normal',4,10,'{"heal":30}','HPを30回復する'),
 ('antidote','どくけし草','consumable','normal',5,12,'{"cure":["poison"]}','毒を治す'),
 ('slime_jelly','スライムゼリー','material','normal',3,NULL,'{}','ぷるぷるした素材'),
 ('rabbit_horn','うさぎの角','material','normal',6,NULL,'{}','角ウサギの小さな角'),
 ('mushroom_cap','キノコのかさ','material','normal',5,NULL,'{}','森のキノコのかさ'),
 ('goblin_shard','錆びた刃片','material','normal',9,NULL,'{}','ゴブリンの短剣のかけら'),
 ('dog_fang','野犬の牙','material','normal',8,NULL,'{}','鋭い牙');

-- behavior: { actions:[{kind,weight,name?,mult?,inflict?{status,rate}}], weakTo:[element] }
INSERT INTO monster_definitions (id,name,level,hp,mp,atk,def,matk,mdef,agi,exp_reward,gold_reward,element,behavior,spawn_areas,spawn_rate) VALUES
 ('slime','スライム',1,22,0,9,3,4,3,3,8,5,'water','{"actions":[{"kind":"attack","weight":1}]}','{green_meadow}',0.30),
 ('horn_rabbit','角ウサギ',2,26,0,12,4,2,3,10,12,7,'none','{"actions":[{"kind":"attack","weight":3},{"kind":"skill","weight":1,"name":"みだれづき","mult":1.3,"inflict":{"status":"def_down","rate":0.3}}]}','{green_meadow}',0.25),
 ('mushroom','森のキノコ',3,34,10,11,6,10,5,4,16,9,'plant','{"actions":[{"kind":"attack","weight":2},{"kind":"skill","weight":1,"name":"毒の胞子","mult":0.6,"inflict":{"status":"poison","rate":0.5}},{"kind":"skill","weight":1,"name":"ねむり胞子","mult":0.4,"inflict":{"status":"sleep","rate":0.35}}],"weakTo":["fire"]}','{green_meadow}',0.20),
 ('goblin','ゴブリン',4,42,6,15,7,5,4,7,22,16,'none','{"actions":[{"kind":"attack","weight":3},{"kind":"skill","weight":1,"name":"おどかす","mult":0.5,"inflict":{"status":"atk_down","rate":0.5}},{"kind":"skill","weight":1,"name":"あやしい粉","mult":0.3,"inflict":{"status":"confusion","rate":0.35}}]}','{green_meadow}',0.15),
 ('wild_dog','野犬',5,48,0,17,6,2,4,12,28,12,'none','{"actions":[{"kind":"attack","weight":3},{"kind":"skill","weight":1,"name":"かみつき","mult":1.2,"inflict":{"status":"paralysis","rate":0.25}},{"kind":"skill","weight":1,"name":"とおぼえ","mult":0.3,"inflict":{"status":"silence","rate":0.4}}]}','{green_meadow}',0.10);

INSERT INTO monster_drops (monster_id,item_id,drop_rate,min_qty,max_qty) VALUES
 ('slime','slime_jelly',0.5,1,2),('slime','potion_small',0.15,1,1),
 ('horn_rabbit','rabbit_horn',0.4,1,1),('horn_rabbit','potion_small',0.1,1,1),
 ('mushroom','mushroom_cap',0.5,1,1),('mushroom','antidote',0.2,1,1),
 ('goblin','goblin_shard',0.3,1,1),('goblin','potion_small',0.2,1,1),
 ('wild_dog','dog_fang',0.4,1,1);
