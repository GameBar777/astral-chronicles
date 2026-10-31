-- PHASE 7: social (friends / party / guild / chat)
CREATE TABLE IF NOT EXISTS social_invites (
  kind text NOT NULL CHECK (kind IN ('party','guild')),
  scope_id uuid NOT NULL,                 -- party id / guild id
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,   -- invitee
  invited_by uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, scope_id, character_id)
);
CREATE INDEX IF NOT EXISTS ix_social_invites_char ON social_invites(character_id);
-- one active party per character (rows are deleted on leave; disbanded parties have no members)
CREATE UNIQUE INDEX IF NOT EXISTS ux_party_members_one ON party_members(character_id);
CREATE INDEX IF NOT EXISTS ix_chat_recipient_time ON chat_messages(recipient_character_id, created_at DESC);
