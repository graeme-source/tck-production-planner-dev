-- Standing reminders for the morning meeting (Graeme, 23 Oct 2026).
-- Objective E (team / meeting).
--
-- Reminders used to be a "Reminders" note slide on ONE day's meeting, so a
-- reminder added today was gone tomorrow. These rows show on EVERY morning
-- meeting from the day they're added until someone removes them — the same
-- way open safety issues stay on the Safety slide until they're cleared.
--
--   text            the reminder itself
--   for_whom        optional — who it's for ("Packing", "Jane"); free text
--   starts_on       London date it was added; it shows from this day on
--   removed_*       soft remove, kept for the audit trail. A removed
--                   reminder can be put back (undo) by clearing these.
--
-- Rules for which reminders show on a day: api-server lib/meeting-reminders.ts.
-- Read/written by routes/meeting-reminders.ts.

CREATE TABLE IF NOT EXISTS meeting_reminders (
  id                  SERIAL PRIMARY KEY,
  text                TEXT NOT NULL CHECK (length(btrim(text)) > 0),
  for_whom            TEXT,
  starts_on           DATE NOT NULL,
  created_by_user_id  INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name     TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  removed_at          TIMESTAMP,
  removed_by_user_id  INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  removed_by_name     TEXT
);

CREATE INDEX IF NOT EXISTS meeting_reminders_active_idx
  ON meeting_reminders (removed_at, starts_on);
