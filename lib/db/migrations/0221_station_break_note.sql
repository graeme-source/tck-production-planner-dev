-- An optional note on a station break (Fix queue #61, Dave Bewsey: "couldnt
-- pause lunch when dealing with apc"). Objective H.
--
--   station_breaks.note   NULL = no note. Typed on the break screen ("Anything
--       to note?", e.g. "called back for APC") and autosaved to the break;
--       shown in Analytics → Breaks & Lunches beside the break.
--
-- A break still can't be paused — the workaround stays: end the break, deal
-- with the job, start Lunch again; the note explains the gap.
-- Idempotent: re-running changes nothing.

ALTER TABLE station_breaks ADD COLUMN IF NOT EXISTS note TEXT;
