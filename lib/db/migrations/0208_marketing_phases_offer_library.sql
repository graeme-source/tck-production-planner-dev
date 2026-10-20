-- Marketing calendar = PHASES + Klaviyo emails (Graeme, 20 Oct 2026).
-- Objective I (the founder sees what's on and approves every email).
--
-- "Strip this back and make it a lot easier to manage … in the calendar
-- we'll just have PHASES, easy to edit. A phase can have an offer on it …
-- keep a list of previous offers and phases we've used and pick one to
-- re-use." Emails are only ever built in Klaviyo; the calendar reads them
-- and records ONE approval per Klaviyo email.
--
-- 1. marketing_offers — the offer library ("Free pack for orders over
--    £39.95" is just a list item). Typing a new offer on a phase adds it
--    here. archived = kept but not offered for new phases; deleted_at =
--    soft delete. Phases hold the offer TEXT (marketing_events.offers), so
--    editing or deleting a library offer never changes a phase.
--    Seeded once from every distinct non-empty offer already in use: the
--    phases' offer text and the (now unused) offer cycle's offers. Case and
--    spacing don't make a second copy.
--
-- 2. marketing_events (a phase) gains:
--      offers          zero or more offers, as text, in order. Backfilled
--                      from the old single `offer` column. The server keeps
--                      `offer` in step (offers joined) for older readers.
--      customer_group  all | new | returning | subscription (default all).
--    A non-empty old one-line `summary` is moved to the top of `notes` (the
--    summary field is no longer shown); the summary column itself is left
--    as it was, so nothing is lost.
--
-- 3. marketing_email_approvals gains the rest of the snapshot taken at
--    approval: preview_text and send_at. If the Klaviyo email's subject,
--    preview text or send time changes afterwards it needs approving again.
--    snapshot_full marks rows approved with the full snapshot; older rows
--    (subject only) are compared on the subject alone.
--
-- Nothing is dropped. The offer-cycle tables, planned emails
-- (marketing_emails) and note events stay in the database untouched — the
-- calendar simply stops using them. Idempotent: re-running changes nothing.

-- 1. Offer library ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_offers (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  notes TEXT,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  updated_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  deleted_by_name TEXT
);

-- One live offer per wording (ignoring case and repeated spaces).
CREATE UNIQUE INDEX IF NOT EXISTS marketing_offers_text_live_uq
  ON marketing_offers (lower(regexp_replace(btrim(text), '\s+', ' ', 'g')))
  WHERE deleted_at IS NULL;

-- 2. Phases: offers + customer group ─────────────────────────────────────
ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS offers TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS customer_group TEXT NOT NULL DEFAULT 'all';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_events_customer_group_chk') THEN
    ALTER TABLE marketing_events ADD CONSTRAINT marketing_events_customer_group_chk
      CHECK (customer_group IN ('all', 'new', 'returning', 'subscription'));
  END IF;
END $$;

UPDATE marketing_events
   SET offers = ARRAY[btrim(offer)]
 WHERE offers = '{}' AND offer IS NOT NULL AND btrim(offer) <> '';

-- The one-line summary isn't shown any more: keep its words at the top of
-- the notes (only where the notes don't already start with it).
UPDATE marketing_events
   SET notes = CASE
         WHEN notes IS NULL OR btrim(notes) = '' THEN btrim(summary)
         ELSE btrim(summary) || E'\n\n' || notes
       END
 WHERE summary IS NOT NULL AND btrim(summary) <> ''
   AND (notes IS NULL OR position(btrim(summary) IN notes) <> 1);

-- Seed the library (only offers not already in it).
WITH used AS (
  SELECT btrim(o) AS text, 1 AS src, e.start_date AS at
    FROM marketing_events e, unnest(e.offers) AS o
   WHERE e.deleted_at IS NULL AND e.event_type <> 'note' AND btrim(o) <> ''
  UNION ALL
  SELECT btrim(c.name), 2, NULL::date
    FROM marketing_cycle_offers c
   WHERE c.deleted_at IS NULL AND btrim(c.name) <> ''
), firsts AS (
  SELECT DISTINCT ON (lower(regexp_replace(text, '\s+', ' ', 'g')))
         regexp_replace(text, '\s+', ' ', 'g') AS text
    FROM used
   ORDER BY lower(regexp_replace(text, '\s+', ' ', 'g')), src, at
)
INSERT INTO marketing_offers (text, created_by_name, updated_by_name)
SELECT f.text, 'Calendar set-up', 'Calendar set-up'
  FROM firsts f
 WHERE NOT EXISTS (
   SELECT 1 FROM marketing_offers m
    WHERE m.deleted_at IS NULL
      AND lower(regexp_replace(btrim(m.text), '\s+', ' ', 'g')) = lower(f.text)
 );

-- 3. Approval snapshot ────────────────────────────────────────────────────
ALTER TABLE marketing_email_approvals ADD COLUMN IF NOT EXISTS preview_text TEXT;
ALTER TABLE marketing_email_approvals ADD COLUMN IF NOT EXISTS send_at TIMESTAMPTZ;
ALTER TABLE marketing_email_approvals ADD COLUMN IF NOT EXISTS snapshot_full BOOLEAN NOT NULL DEFAULT FALSE;
