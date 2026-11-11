-- PHASE 8: instance dungeon "古代地下遺跡" (party battle, boss phases, per-member rewards)
ALTER TABLE dungeon_instances
  ADD COLUMN IF NOT EXISTS leader_character_id uuid REFERENCES characters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS state jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS dungeon_members (
  instance_id uuid NOT NULL REFERENCES dungeon_instances(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz,
  PRIMARY KEY (instance_id, character_id)
);
-- a character can be inside at most one instance
CREATE UNIQUE INDEX IF NOT EXISTS ux_dungeon_member_active ON dungeon_members(character_id) WHERE left_at IS NULL;
ALTER TABLE battle_logs ALTER COLUMN character_id DROP NOT NULL;
ALTER TABLE battle_logs ADD COLUMN IF NOT EXISTS pending jsonb NOT NULL DEFAULT '{}', ADD COLUMN IF NOT EXISTS deadline_at timestamptz;
-- one running battle per instance
CREATE UNIQUE INDEX IF NOT EXISTS ux_battle_dungeon_active ON battle_logs(dungeon_instance_id) WHERE result IS NULL AND dungeon_instance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_battle_participants ON battle_logs USING gin(participants);

INSERT INTO monster_definitions (id,name,level,hp,mp,atk,def,matk,mdef,agi,exp_reward,gold_reward,element,behavior,spawn_areas,spawn_rate,is_boss) VALUES
 ('ruins_bat','遺跡コウモリ',4,30,0,13,4,6,4,14,18,10,'dark','{"actions":[{"kind":"attack","weight":3},{"kind":"skill","weight":1,"name":"超音波","mult":0.5,"inflict":{"status":"confusion","rate":0.3}}]}','{ancient_ruins}',0.5,false),
 ('ruins_skeleton','スケルトン兵',5,48,0,16,8,4,4,7,26,14,'dark','{"actions":[{"kind":"attack","weight":3},{"kind":"skill","weight":1,"name":"骨砕き","mult":1.4}],"weakTo":["fire"]}','{ancient_ruins}',0.5,false),
 ('ruins_golem','遺跡の守護者ゴーレム',8,300,40,18,10,14,8,5,120,80,'earth',
  '{"actions":[{"kind":"attack","weight":3},{"kind":"skill","weight":1,"name":"岩石落とし","mult":0.8,"aoe":true}],
    "phases":[
      {"at":0.6,"name":"覚醒","text":"ゴーレムの目が赤く光った！（フェーズ2：攻撃力上昇）","atkMul":1.25,
       "actions":[{"kind":"attack","weight":2},{"kind":"skill","weight":2,"name":"岩石落とし","mult":0.9,"aoe":true},{"kind":"skill","weight":1,"name":"地鳴り","mult":0.6,"aoe":true,"inflict":{"status":"def_down","rate":0.4}}]},
      {"at":0.25,"name":"暴走","text":"ゴーレムが暴走を始めた！（フェーズ3：防御を捨てて猛攻）","atkMul":1.2,"defMul":0.6,
       "actions":[{"kind":"skill","weight":2,"name":"崩壊の拳","mult":1.5},{"kind":"skill","weight":2,"name":"岩石落とし","mult":1.0,"aoe":true}]}
    ]}','{ancient_ruins_boss}',0,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO monster_drops (monster_id,item_id,drop_rate,min_qty,max_qty) VALUES
 ('ruins_bat','beast_hide',0.4,1,1),('ruins_skeleton','iron_ore',0.4,1,2),('ruins_skeleton','potion_small',0.15,1,1),
 ('ruins_golem','magic_stone',1.0,1,2),('ruins_golem','silver_ore',0.6,1,2)
ON CONFLICT DO NOTHING;
