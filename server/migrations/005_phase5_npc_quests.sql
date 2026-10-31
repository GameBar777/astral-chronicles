-- PHASE 5: NPC shop / inn / quests (SECTION 13-14). Reward guard: character_quests row lock + transactions 'quest:<id>:<n>'.
INSERT INTO item_definitions (id, name, category, rarity, stackable, max_stack, sell_price, buy_price, effect, description) VALUES
 ('chief_letter','村長の手紙','quest','normal',false,1,0,NULL,'{}','鍛冶屋ゴルドに届ける封書');

CREATE TABLE shop_items (
  npc_id text NOT NULL, item_id text NOT NULL REFERENCES item_definitions(id),
  sort int NOT NULL DEFAULT 0, PRIMARY KEY (npc_id, item_id)
);
INSERT INTO shop_items (npc_id, item_id, sort) VALUES
 ('npc_shop_mira','potion_small',1),('npc_shop_mira','antidote',2),('npc_shop_mira','ether_small',3),
 ('npc_shop_mira','wooden_sword',10),('npc_shop_mira','oak_staff',11),('npc_shop_mira','wooden_shield',12),('npc_shop_mira','copper_dagger',13);
UPDATE item_definitions SET buy_price = COALESCE(buy_price, 30) WHERE id = 'ether_small';

-- objectives: kill {monsterId,qty} counted from committed battle rewards; collect {itemId,qty} consumed on turn-in;
-- deliver {itemId,npcId} the quest item is handed in at npcId. rewards: {gold,exp,items:[{itemId,qty}]}
INSERT INTO quests (id, name, category, npc_id, requirements, objectives, rewards, max_repeats, description) VALUES
 ('q_hunt_slime','スライム退治','hunt','npc_chief_bram','{"level":1}','[{"type":"kill","monsterId":"slime","qty":3}]',
  '{"gold":60,"exp":40,"items":[{"itemId":"potion_small","qty":2}]}',1,'草原のスライムを3匹退治してほしい。'),
 ('q_gather_herb','薬草あつめ','gather','npc_shop_mira','{"level":1}','[{"type":"collect","itemId":"herb","qty":3}]',
  '{"gold":40,"exp":25,"items":[{"itemId":"antidote","qty":1}]}',1,'薬草を3つ持ってきてくれる？'),
 ('q_deliver_letter','村長の手紙','delivery','npc_chief_bram','{"level":1}','[{"type":"deliver","itemId":"chief_letter","npcId":"npc_smith_gord"}]',
  '{"gold":30,"exp":20,"items":[]}',1,'この手紙を鍛冶屋のゴルドに届けてくれ。'),
 ('q_daily_hunt','毎日の見回り','daily','npc_guard_leon','{"level":1}','[{"type":"kill","monsterId":"slime","qty":5}]',
  '{"gold":50,"exp":30,"items":[]}',100000,'今日も草原でスライムを5匹倒してくれ。（毎日 JST 0時リセット）');
