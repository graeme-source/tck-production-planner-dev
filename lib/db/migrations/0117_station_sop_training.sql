-- Station SOP training (Graeme, 2026-09-24).
--
-- Every SOP attached to the front of a station (sop_links, target_type
-- 'station') is something anyone working that station must have reviewed —
-- and must RE-review whenever its content changes. The station training
-- matrix is DERIVED from sop_links + these tables, never copied, so
-- attaching or detaching an SOP changes the matrix instantly with nothing
-- to sync.
--
--   standards_sops.content_version     bumped on every change to the steps
--       (text, photos, videos, order). Title, station and tag edits do NOT
--       bump it — renaming an SOP shouldn't send the whole team back to
--       re-read it. An integer, not a timestamp, so a version can round-trip
--       through the browser without microsecond precision loss.
--   standards_sops.content_changed_at  when that last happened (display).
--
--   sop_reviews         one row per review, kept forever as the audit trail
--                       ("trained, date- and time-stamped"). A person's
--                       status on an SOP is their newest row's version
--                       against the SOP's current version.
--   sop_review_windows  when a person was FIRST asked to review an SOP they
--                       are behind on — the start of their 24-hour skip
--                       window. Deleted when they review, so the next
--                       change starts a fresh window; repeated edits while
--                       they're still behind do not reset the clock.
--   station_gate_events every "skip for now" and "just checking" at a
--                       station gate, so nobody quietly works around it.

ALTER TABLE standards_sops ADD COLUMN IF NOT EXISTS content_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE standards_sops ADD COLUMN IF NOT EXISTS content_changed_at TIMESTAMP;
UPDATE standards_sops SET content_changed_at = updated_at WHERE content_changed_at IS NULL;
ALTER TABLE standards_sops ALTER COLUMN content_changed_at SET DEFAULT NOW();
ALTER TABLE standards_sops ALTER COLUMN content_changed_at SET NOT NULL;

CREATE TABLE IF NOT EXISTS sop_reviews (
  id                  SERIAL PRIMARY KEY,
  sop_id              INTEGER NOT NULL REFERENCES standards_sops(id) ON DELETE CASCADE,
  user_id             INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  content_version     INTEGER NOT NULL,
  reviewed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 'station_gate' | 'matrix' | 'author'
  source              TEXT NOT NULL,
  station             TEXT
);
CREATE INDEX IF NOT EXISTS sop_reviews_user_sop_idx ON sop_reviews (user_id, sop_id, content_version DESC);
CREATE INDEX IF NOT EXISTS sop_reviews_sop_idx ON sop_reviews (sop_id);

CREATE TABLE IF NOT EXISTS sop_review_windows (
  sop_id            INTEGER NOT NULL REFERENCES standards_sops(id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  first_prompted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sop_id, user_id)
);

CREATE TABLE IF NOT EXISTS station_gate_events (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  station     TEXT NOT NULL,
  -- 'skipped' | 'just_looking'
  kind        TEXT NOT NULL,
  sop_ids     INTEGER[] NOT NULL DEFAULT '{}',
  -- A skip holds the gate off until the earliest review deadline; "just
  -- checking" lasts until the end of that London day.
  valid_until TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS station_gate_events_user_station_idx ON station_gate_events (user_id, station, valid_until DESC);
