-- Team messages (Graeme, 2026-10-07): station messages grow into a
-- WhatsApp-style team chat — messages to Everyone, to one or more stations
-- and/or one or more people, with replies, @mentions, read state and
-- per-message "must be confirmed". Objective H (team communication).
-- The rules live in lib/messages (pure, tested); routes/messages.ts uses them.
--
--   team_message_conversations  one row per AUDIENCE (a chat). key is the
--                               canonical audience ("everyone", "s:packing",
--                               "u:3,u:7", "s:packing,u:3,u:7"); a
--                               person-addressed chat includes its starter.
--   team_messages               the messages. parent_id = the message this
--                               one replies to (quoted above it);
--                               parent_sender_user_id lets the quoted
--                               person always see the reply. Soft delete.
--   team_message_mentions       @mentions (body stores them as <@id>).
--   team_message_reads          per-person read state ("Seen by N").
--   team_message_acks           "Got it" confirmations: target is
--                               'station:<key>' (a shared station iPad
--                               confirms for the station, as before) or
--                               'user:<id>'.
--
-- station_messages is carried over below (history AND who confirmed what,
-- when) and left in place untouched, so this is revertable; nothing writes
-- to it any more.

CREATE TABLE IF NOT EXISTS team_message_conversations (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  is_everyone BOOLEAN NOT NULL DEFAULT FALSE,
  station_keys TEXT[] NOT NULL DEFAULT '{}',
  user_ids INTEGER[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_team_message_conversations_stations ON team_message_conversations USING GIN (station_keys);
CREATE INDEX IF NOT EXISTS idx_team_message_conversations_users ON team_message_conversations USING GIN (user_ids);

CREATE TABLE IF NOT EXISTS team_messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES team_message_conversations(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES team_messages(id) ON DELETE SET NULL,
  parent_sender_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  sender_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  sender_name TEXT,
  body TEXT NOT NULL,
  requires_ack BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  -- The station_messages row this was carried over from (never unread).
  legacy_station_message_id INTEGER UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_team_messages_conversation ON team_messages(conversation_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_team_messages_created ON team_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_team_messages_sender ON team_messages(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_team_messages_parent_sender ON team_messages(parent_sender_user_id);

CREATE TABLE IF NOT EXISTS team_message_mentions (
  message_id INTEGER NOT NULL REFERENCES team_messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_message_mentions_user ON team_message_mentions(user_id);

CREATE TABLE IF NOT EXISTS team_message_reads (
  message_id INTEGER NOT NULL REFERENCES team_messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_message_reads_user ON team_message_reads(user_id);

CREATE TABLE IF NOT EXISTS team_message_acks (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES team_messages(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  acked_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  acked_by_name TEXT,
  acked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, target)
);

-- ── Carry the station messages over ─────────────────────────────────────────
-- One chat per station ("s:<station>"), each message with its sender, time
-- and must-confirm flag; a dismissed/confirmed one keeps who and when as a
-- station confirmation. Idempotent via legacy_station_message_id.

INSERT INTO team_message_conversations (key, is_everyone, station_keys, user_ids, created_at, last_message_at)
SELECT 's:' || sm.station_type, FALSE, ARRAY[sm.station_type], '{}', MIN(sm.created_at), MAX(sm.created_at)
FROM station_messages sm
GROUP BY sm.station_type
ON CONFLICT (key) DO UPDATE SET last_message_at = GREATEST(team_message_conversations.last_message_at, EXCLUDED.last_message_at);

INSERT INTO team_messages (conversation_id, sender_user_id, sender_name, body, requires_ack, created_at, legacy_station_message_id)
SELECT c.id, sm.created_by_user_id, sm.created_by_name, sm.body, sm.requires_ack, sm.created_at, sm.id
FROM station_messages sm
JOIN team_message_conversations c ON c.key = 's:' || sm.station_type
WHERE NOT EXISTS (SELECT 1 FROM team_messages tm WHERE tm.legacy_station_message_id = sm.id)
ORDER BY sm.id;

INSERT INTO team_message_acks (message_id, target, acked_by_user_id, acked_by_name, acked_at)
SELECT tm.id, 'station:' || sm.station_type, NULL, sm.dismissed_by_name, sm.dismissed_at
FROM station_messages sm
JOIN team_messages tm ON tm.legacy_station_message_id = sm.id
WHERE sm.dismissed_at IS NOT NULL
ON CONFLICT (message_id, target) DO NOTHING;
