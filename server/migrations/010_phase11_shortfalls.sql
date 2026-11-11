-- Follow-up: email confirmation / password reset tokens, equipment durability, guild XP & warehouse, market sale history
-- Existing accounts are treated as already verified so no one is locked out.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
UPDATE users SET email_verified_at = coalesce(email_verified_at, created_at, now()) WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS email_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('confirm', 'reset')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_email_tokens_user ON email_tokens(user_id, kind);

-- equipment durability (NULL = not an equip / not tracked). Max is derived from item definition.
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS durability int;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS max_durability int;

-- guild progression + warehouse (one shared inventory per guild, staff can withdraw)
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS level int NOT NULL DEFAULT 1;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS exp int NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS guild_storage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  item_id text NOT NULL REFERENCES item_definitions(id),
  quantity int NOT NULL CHECK (quantity > 0),
  unique (guild_id, item_id)
);
CREATE TABLE IF NOT EXISTS guild_storage_log (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  character_id uuid REFERENCES characters(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('deposit', 'withdraw')),
  item_id text NOT NULL, quantity int NOT NULL
);

-- sold market listings already keep price/qty/sold_at; this rollup makes history queries cheap
CREATE TABLE IF NOT EXISTS market_price_history (
  id bigserial PRIMARY KEY,
  item_id text NOT NULL REFERENCES item_definitions(id),
  unit_price int NOT NULL,
  quantity int NOT NULL,
  sold_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_market_hist_item ON market_price_history(item_id, sold_at DESC);
