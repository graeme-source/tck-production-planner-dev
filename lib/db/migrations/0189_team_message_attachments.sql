-- Photos and videos in team messages (Graeme, 2026-10-13: "we need to be
-- able to send picture and video information across to each other", like
-- WhatsApp). Objectives F (nothing lost) and H (team communication).
--
-- Same storage as every other photo/video in the app (to-do, improvement,
-- andon attachments): the bytes live in Postgres as bytea, streamed back by
-- the API. Limits are the shared ones in @workspace/messages (media.ts):
-- photos 10 MB, videos 100 MB, up to 10 per message.
--
-- A file is uploaded the moment it's picked (so Send is quick and each file
-- shows its own progress) and sits with message_id NULL, visible only to
-- whoever uploaded it, until the message is sent and claims it. Unclaimed
-- uploads are cleared after 24 hours by the upload route.
--
-- Who may fetch the bytes: exactly who may see the message
-- (canFetchMessageMedia in lib/messages, enforced in
-- routes/message-media.ts). A deleted message's media is served to nobody.
-- ON DELETE CASCADE: removing a message row (never done today — deletes are
-- soft) takes its media with it.

CREATE TABLE IF NOT EXISTS team_message_attachments (
  id SERIAL PRIMARY KEY,
  message_id INTEGER REFERENCES team_messages(id) ON DELETE CASCADE,
  uploaded_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  mime TEXT NOT NULL,
  data BYTEA NOT NULL,
  file_name TEXT,
  size_bytes INTEGER NOT NULL,
  -- Measured by the app when picked (video length, picture shape) so the
  -- bubble can lay out and show "0:42" before any bytes load.
  duration_seconds REAL,
  width INTEGER,
  height INTEGER,
  -- Order within the message (the order they were picked).
  position SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_message_attachments_message
  ON team_message_attachments(message_id, position);
CREATE INDEX IF NOT EXISTS idx_team_message_attachments_pending
  ON team_message_attachments(created_at) WHERE message_id IS NULL;
