-- PHASE 9: player market (escrowed listings, sale fee, expiry, history), guild ranking support
CREATE TABLE IF NOT EXISTS market_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id text NOT NULL REFERENCES item_definitions(id),
  quantity int NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  enhance_level int NOT NULL DEFAULT 0,
  price bigint NOT NULL CHECK (price BETWEEN 1 AND 9999999),   -- total price for the whole lot
  fee_rate numeric(4,3) NOT NULL,                               -- snapshot of the fee at listing time
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold','cancelled','reclaimed')),
  buyer_character_id uuid REFERENCES characters(id) ON DELETE SET NULL,
  fee bigint, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_market_active ON market_listings(item_id, price) WHERE status='active';
CREATE INDEX IF NOT EXISTS ix_market_seller ON market_listings(seller_character_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_market_buyer ON market_listings(buyer_character_id, closed_at DESC);
