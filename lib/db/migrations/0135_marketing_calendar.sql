-- Visual marketing calendar (Graeme, 2026-09-29): Graeme and the marketing
-- team plan together on a month grid / timeline instead of a 6-week list —
-- any dates (Black Friday planned now), who added and who last changed each
-- event, and a change history so nobody's work silently disappears.
-- Objectives I (founder foresight — always something on) and F (trustworthy:
-- every change attributed, nothing hard-deleted).
--
-- marketing_events keeps its existing columns so no row is lost or renamed:
--   name   = the event title      offer  = the offer details
--   notes  = long notes           source = 'manual' | 'ai' (AI marker kept)
--   status gains 'live' and 'done' beside 'idea' / 'planned'.
-- New columns: a short summary, a type (drives the colour), channels,
-- audience, created/updated by (id + name, the name frozen at the time so
-- history reads right even if an account is renamed), updated_at, and a
-- soft delete (deleted_at/by) so history survives a delete.
--
-- marketing_event_history — one row per change: created / edited / moved /
-- resized / deleted, with a human sentence ("moved from 16–29 Oct to
-- 18–31 Oct") and the changed fields as JSON.
--
-- Existing rows: only the founder could create events before today, so they
-- are stamped as his, and each gets a 'created' history row at its original
-- created_at.

ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'campaign';
ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS channels TEXT[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS audience TEXT;
ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS created_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS created_by_name TEXT;
ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS updated_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS updated_by_name TEXT;
ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS deleted_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS deleted_by_name TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_events_dates_ck') THEN
    ALTER TABLE marketing_events ADD CONSTRAINT marketing_events_dates_ck CHECK (end_date >= start_date);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_marketing_events_dates ON marketing_events (start_date, end_date) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS marketing_event_history (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES marketing_events(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  user_name TEXT,
  action TEXT NOT NULL CHECK (action IN ('created', 'edited', 'moved', 'resized', 'deleted')),
  summary TEXT NOT NULL,
  changes JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_marketing_event_history_event ON marketing_event_history (event_id, created_at);

-- Stamp the existing rows as the founder's (he was the only one who could add them).
UPDATE marketing_events e SET
  created_by_id = u.id, created_by_name = u.name,
  updated_by_id = u.id, updated_by_name = u.name,
  updated_at = e.created_at
FROM app_users u
WHERE u.email = 'graeme@thecalzonekitchen.co.uk' AND e.created_by_id IS NULL;

INSERT INTO marketing_event_history (event_id, user_id, user_name, action, summary, created_at)
SELECT e.id, e.created_by_id, e.created_by_name, 'created',
       CASE WHEN e.source = 'ai' THEN 'Added from an AI suggestion' ELSE 'Added' END,
       e.created_at
FROM marketing_events e
WHERE NOT EXISTS (SELECT 1 FROM marketing_event_history h WHERE h.event_id = e.id);
