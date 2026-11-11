-- PHASE 10: operation logs, admin tooling (maintenance / announcements), persistent chat mutes, blocks
CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, actor_character_id uuid REFERENCES characters(id) ON DELETE SET NULL,
  action text NOT NULL, target text, detail jsonb NOT NULL DEFAULT '{}', ip text
);
CREATE INDEX IF NOT EXISTS ix_audit_time ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_action ON audit_logs(action, created_at DESC);
CREATE TABLE IF NOT EXISTS server_settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO server_settings(key,value) VALUES ('maintenance','{"on":false,"message":""}') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS announcements (
  id bigserial PRIMARY KEY, title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60), body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz, created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_mutes (
  character_id uuid PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE, until timestamptz NOT NULL, reason text NOT NULL DEFAULT 'spam', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS character_blocks (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE, blocked_character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (character_id, blocked_character_id), CHECK (character_id <> blocked_character_id)
);
CREATE INDEX IF NOT EXISTS ix_blocks_blocked ON character_blocks(blocked_character_id);
