-- A lean lesson day can carry its own uploaded video (Graeme, 20 Nov 2026:
-- "I've recorded my own video… I need to be able to upload it into this
-- lean lesson"). One video per lesson day, in its own table so the many
-- queries that read lean_examples never drag a video along. The lesson's
-- video_url points at /api/lean-videos/<id>, so every place that already
-- plays a lesson's video plays this one too.
-- STORAGE EXTERNAL: video is already compressed, and uncompressed out-of-line
-- storage lets the player fetch byte ranges without reading the whole file.
-- Objective E. Safe to run twice.

CREATE TABLE IF NOT EXISTS lean_example_videos (
  example_id INTEGER PRIMARY KEY REFERENCES lean_examples(id) ON DELETE CASCADE,
  video BYTEA NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  file_name TEXT,
  uploaded_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE lean_example_videos ALTER COLUMN video SET STORAGE EXTERNAL;
