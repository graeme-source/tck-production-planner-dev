-- Meetings, AI first (Graeme, 2026-10-12): "What I really want to be able to
-- do is to schedule a meeting. I can give it a title… record the meeting on
-- AI note summary and then upload that summary." Objectives I and H.
--
--   • people_record_classifications.default_for_meetings — the classification
--     a newly scheduled meeting starts as when nobody picks one (the AI
--     suggests a better one from the notes later). Data, not a name match in
--     code: seeded once onto the existing "1:1 / catch-up" row from 0178, and
--     only when no row is flagged yet. Editable like any other list value.
--   • people_record_entry_sources — the meeting notes an AI draft was made
--     from: the shared-notes link (if any) and the raw text, kept on the
--     entry for audit. People access only (served behind the People PIN with
--     the rest of the record). Never hard-deleted; nothing is copied or
--     removed from existing entries.
--
-- Idempotent: re-running changes nothing.

ALTER TABLE people_record_classifications
  ADD COLUMN IF NOT EXISTS default_for_meetings BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE people_record_classifications
   SET default_for_meetings = TRUE, updated_at = NOW()
 WHERE id = (SELECT id FROM people_record_classifications
              WHERE lower(label) = lower('1:1 / catch-up') AND active
              ORDER BY id LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM people_record_classifications WHERE default_for_meetings);

CREATE TABLE IF NOT EXISTS people_record_entry_sources (
  id              SERIAL PRIMARY KEY,
  entry_id        INTEGER NOT NULL REFERENCES people_record_entries(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  -- url | text
  kind            TEXT NOT NULL,
  source_url      TEXT,
  raw_text        TEXT NOT NULL,
  model           TEXT,
  created_by_id   INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS people_record_entry_sources_entry_idx ON people_record_entry_sources(entry_id);
