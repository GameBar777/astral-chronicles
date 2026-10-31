-- ASTRAL CHRONICLES initial schema (SECTION 19)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,                 -- bcrypt; never sent to client
  role          text NOT NULL DEFAULT 'player' CHECK (role IN ('player','gm','admin')),
  is_banned     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE item_definitions (
  id           text PRIMARY KEY,               -- e.g. 'mat_copper_ore'
  name         text NOT NULL,
  category     text NOT NULL CHECK (category IN ('equipment','consumable','material','quest','misc')),
  rarity       text NOT NULL DEFAULT 'normal' CHECK (rarity IN ('normal','rare','epic','legendary','mythic')),
  stackable    boolean NOT NULL DEFAULT true,
  max_stack    int NOT NULL DEFAULT 99 CHECK (max_stack > 0),
  sell_price   int NOT NULL DEFAULT 0 CHECK (sell_price >= 0),
  buy_price    int CHECK (buy_price >= 0),
  effect       jsonb NOT NULL DEFAULT '{}',
  description  text NOT NULL DEFAULT '',
  is_dummy     boolean NOT NULL DEFAULT false  -- SECTION27-4: distinguish dummy data
);

CREATE TABLE equipment_definitions (
  item_id         text PRIMARY KEY REFERENCES item_definitions(id) ON DELETE CASCADE,
  slot_category   text NOT NULL CHECK (slot_category IN ('one_hand_sword','two_hand_sword','spear','staff','dagger','shield','head','body','arms','legs','accessory')),
  level_req       int NOT NULL DEFAULT 1 CHECK (level_req BETWEEN 1 AND 100),
  class_restrict  text[] NOT NULL DEFAULT '{}',  -- empty = all classes
  atk int NOT NULL DEFAULT 0, def int NOT NULL DEFAULT 0, matk int NOT NULL DEFAULT 0, mdef int NOT NULL DEFAULT 0,
  special_effect  jsonb NOT NULL DEFAULT '{}',
  craft_materials jsonb NOT NULL DEFAULT '[]',
  obtain_from     text NOT NULL DEFAULT ''
);

CREATE TABLE characters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  class       text NOT NULL CHECK (class IN ('warrior','knight','mage','priest')),
  appearance  jsonb NOT NULL DEFAULT '{}',   -- body type, hair style/color, skin
  level       int NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 100),
  exp         bigint NOT NULL DEFAULT 0 CHECK (exp >= 0),
  gold        bigint NOT NULL DEFAULT 0 CHECK (gold >= 0),
  map_id      text NOT NULL DEFAULT 'asteria',
  pos_x       int NOT NULL DEFAULT 0,
  pos_y       int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX ux_characters_name_ci ON characters (lower(name));
CREATE INDEX ix_characters_user ON characters(user_id);

CREATE TABLE character_stats (
  character_id uuid PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  hp int NOT NULL, max_hp int NOT NULL, mp int NOT NULL, max_mp int NOT NULL,
  str int NOT NULL, vit int NOT NULL, "int" int NOT NULL, agi int NOT NULL, luk int NOT NULL,
  atk int NOT NULL, def int NOT NULL, matk int NOT NULL, mdef int NOT NULL,
  gathering_levels jsonb NOT NULL DEFAULT '{"mining":1,"logging":1,"herb":1,"monster":1}',
  CHECK (hp >= 0 AND hp <= max_hp AND mp >= 0 AND mp <= max_mp)
);

CREATE TABLE inventory (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- unique instance id
  character_id  uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id       text NOT NULL REFERENCES item_definitions(id),
  quantity      int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  enhance_level int NOT NULL DEFAULT 0 CHECK (enhance_level BETWEEN 0 AND 10),
  roll_stats    jsonb NOT NULL DEFAULT '{}',  -- per-instance stats
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_inventory_character ON inventory(character_id);

CREATE TABLE character_equipment (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  slot         text NOT NULL CHECK (slot IN ('weapon','shield','head','body','arms','legs','accessory1','accessory2')),
  inventory_id uuid NOT NULL UNIQUE REFERENCES inventory(id) ON DELETE CASCADE,
  PRIMARY KEY (character_id, slot)
);

CREATE TABLE monster_definitions (
  id text PRIMARY KEY, name text NOT NULL,
  level int NOT NULL CHECK (level BETWEEN 1 AND 120),
  hp int NOT NULL, mp int NOT NULL DEFAULT 0, atk int NOT NULL, def int NOT NULL,
  matk int NOT NULL DEFAULT 0, mdef int NOT NULL DEFAULT 0, agi int NOT NULL DEFAULT 1,
  exp_reward int NOT NULL DEFAULT 0, gold_reward int NOT NULL DEFAULT 0,
  element text NOT NULL DEFAULT 'none', behavior jsonb NOT NULL DEFAULT '{}',
  spawn_areas text[] NOT NULL DEFAULT '{}', spawn_rate numeric(5,4) NOT NULL DEFAULT 0,
  is_boss boolean NOT NULL DEFAULT false, is_dummy boolean NOT NULL DEFAULT false
);

CREATE TABLE monster_drops (
  monster_id text NOT NULL REFERENCES monster_definitions(id) ON DELETE CASCADE,
  item_id    text NOT NULL REFERENCES item_definitions(id),
  drop_rate  numeric(6,5) NOT NULL CHECK (drop_rate > 0 AND drop_rate <= 1),
  min_qty int NOT NULL DEFAULT 1, max_qty int NOT NULL DEFAULT 1,
  PRIMARY KEY (monster_id, item_id), CHECK (min_qty <= max_qty)
);

CREATE TABLE quests (
  id text PRIMARY KEY, name text NOT NULL,
  category text NOT NULL CHECK (category IN ('main','sub','daily','weekly','hunt','gather','delivery','dungeon')),
  npc_id text NOT NULL, requirements jsonb NOT NULL DEFAULT '{}', objectives jsonb NOT NULL DEFAULT '[]',
  rewards jsonb NOT NULL DEFAULT '{}', prerequisite_quest_id text REFERENCES quests(id),
  time_limit_sec int, max_repeats int NOT NULL DEFAULT 1, description text NOT NULL DEFAULT ''
);

CREATE TABLE character_quests (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  quest_id text NOT NULL REFERENCES quests(id),
  status text NOT NULL CHECK (status IN ('active','completed','rewarded','failed')),
  progress jsonb NOT NULL DEFAULT '{}', times_completed int NOT NULL DEFAULT 0,
  accepted_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, rewarded_at timestamptz,
  PRIMARY KEY (character_id, quest_id)
);
CREATE INDEX ix_character_quests_status ON character_quests(character_id, status);

CREATE TABLE skills (
  id text PRIMARY KEY, name text NOT NULL, class text CHECK (class IN ('warrior','knight','mage','priest')),
  type text NOT NULL CHECK (type IN ('physical','magic','heal','buff','debuff','passive')),
  mp_cost int NOT NULL DEFAULT 0, power numeric(6,3) NOT NULL DEFAULT 1, target text NOT NULL DEFAULT 'single',
  element text NOT NULL DEFAULT 'none', required_level int NOT NULL DEFAULT 1,
  parent_skill_id text REFERENCES skills(id), effect jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE character_skills (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  skill_id text NOT NULL REFERENCES skills(id), skill_level int NOT NULL DEFAULT 1,
  PRIMARY KEY (character_id, skill_id)
);

CREATE TABLE recipes (
  id text PRIMARY KEY,
  category text NOT NULL CHECK (category IN ('weapon','armor','alchemy','accessory')),
  result_item_id text NOT NULL REFERENCES item_definitions(id), result_qty int NOT NULL DEFAULT 1,
  materials jsonb NOT NULL, required_level int NOT NULL DEFAULT 1,
  craft_time_sec int NOT NULL DEFAULT 0, gold_cost int NOT NULL DEFAULT 0
);

CREATE TABLE gathering_nodes (
  id text PRIMARY KEY, map_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('mining','logging','herb','monster')),
  pos_x int NOT NULL, pos_y int NOT NULL, required_level int NOT NULL DEFAULT 1,
  loot_table jsonb NOT NULL, respawn_sec int NOT NULL DEFAULT 60
);
CREATE INDEX ix_gathering_nodes_map ON gathering_nodes(map_id);

CREATE TABLE guilds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  leader_character_id uuid REFERENCES characters(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_guilds_name_ci ON guilds(lower(name));

CREATE TABLE guild_members (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  character_id uuid NOT NULL UNIQUE REFERENCES characters(id) ON DELETE CASCADE,
  rank text NOT NULL DEFAULT 'member' CHECK (rank IN ('leader','officer','member')),
  joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (guild_id, character_id)
);

CREATE TABLE parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), disbanded_at timestamptz
);

CREATE TABLE party_members (
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (party_id, character_id)
);
CREATE INDEX ix_party_members_character ON party_members(character_id);

CREATE TABLE friends (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  friend_character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending','accepted','blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, friend_character_id), CHECK (character_id <> friend_character_id)
);
CREATE INDEX ix_friends_friend ON friends(friend_character_id);

CREATE TABLE chat_messages (
  id bigserial PRIMARY KEY,
  channel text NOT NULL CHECK (channel IN ('say','party','guild','whisper','system')),
  scope_id text,  -- map id / party id / guild id
  sender_character_id uuid REFERENCES characters(id) ON DELETE SET NULL,
  recipient_character_id uuid REFERENCES characters(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_chat_scope_time ON chat_messages(channel, scope_id, created_at DESC);

CREATE TABLE dungeon_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dungeon_id text NOT NULL,
  party_id uuid REFERENCES parties(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('active','cleared','failed','expired')),
  current_floor int NOT NULL DEFAULT 1, started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, ended_at timestamptz,
  rewards_claimed jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX ix_dungeon_instances_party ON dungeon_instances(party_id);

CREATE TABLE battle_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dungeon_instance_id uuid REFERENCES dungeon_instances(id) ON DELETE SET NULL,
  participants uuid[] NOT NULL, monsters jsonb NOT NULL,
  result text CHECK (result IN ('victory','defeat','fled','aborted')),
  log jsonb NOT NULL DEFAULT '[]', rewards jsonb NOT NULL DEFAULT '{}',
  rewards_committed boolean NOT NULL DEFAULT false,  -- double-reward guard
  started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz
);
CREATE INDEX ix_battle_logs_started ON battle_logs(started_at);

CREATE TABLE transactions (
  id bigserial PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  kind text NOT NULL,  -- battle_reward, shop_buy, shop_sell, craft, enhance, quest_reward, market_*...
  gold_delta bigint NOT NULL DEFAULT 0, items_delta jsonb NOT NULL DEFAULT '[]',
  idempotency_key text NOT NULL,  -- prevents double processing
  ref_id text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (character_id, idempotency_key)
);
CREATE INDEX ix_transactions_character_time ON transactions(character_id, created_at DESC);

CREATE TABLE enhancement_logs (
  id bigserial PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  inventory_id uuid REFERENCES inventory(id) ON DELETE SET NULL,
  from_level int NOT NULL, to_level int NOT NULL, success boolean NOT NULL,
  success_rate numeric(4,3) NOT NULL, gold_cost int NOT NULL, materials jsonb NOT NULL DEFAULT '[]',
  request_id text NOT NULL UNIQUE,  -- idempotency
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_enhancement_logs_character ON enhancement_logs(character_id, created_at DESC);

CREATE TABLE sessions (  -- self-hosted auth interim (TECHNICAL_DECISIONS TD-003)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE INDEX ix_sessions_user ON sessions(user_id);
