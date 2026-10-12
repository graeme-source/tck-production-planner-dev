-- Which attendance trigger a review deals with (Graeme, 2026-10-12).
--
-- "It's automatically assigned it to the sickness review that was due…
-- which I didn't want. I want to disconnect it from that… we need a way to
-- choose what we're going to attach it to." Objectives H and F.
--
--   • people_record_entries.answers_trigger — the review's explicit link to
--     the attendance policy triggers: sickness | lates | both | none.
--     NULL = automatic: the review answers a trigger only if its
--     classification shows attendance evidence (people_record_classifications
--     .evidence — data, never a name). The rule lives in
--     lib/people-reviews/src/policy-trigger.ts (triggersAnswered).
--
-- Nothing is set on existing entries: every row stays NULL (automatic).
-- Idempotent: re-running changes nothing.

ALTER TABLE people_record_entries ADD COLUMN IF NOT EXISTS answers_trigger TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_record_entries_answers_trigger_check') THEN
    ALTER TABLE people_record_entries ADD CONSTRAINT people_record_entries_answers_trigger_check
      CHECK (answers_trigger IS NULL OR answers_trigger IN ('sickness', 'lates', 'both', 'none'));
  END IF;
END $$;
