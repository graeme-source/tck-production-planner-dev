-- Improvement score (Graeme, 2026-10-12). Objective E (continuous
-- improvement built into daily work).
--
-- The Leaner-board now ranks people by credits per shift worked over the
-- last 30 days (api-server lib/improvement-score.ts), not by raw count.
--
-- improvement_submissions.credit_weight — how many credits an improvement
--   is worth: 1 by default, 2 for "a really good one", 3 for "really
--   substantial". Only the founder sets it. Everyone credited on the
--   improvement gets this many credits.
-- credit_weight_set_at / _by — who last changed it, and when.
--
-- planday_shifts_cache.status — the Planday rota status (Assigned,
--   PunchclockStarted, PunchclockFinished, Approved, …), so "shifts actually
--   worked" can be counted from the mirror. Rows synced before this column
--   existed stay NULL until the mirror re-pulls their dates (the score
--   service does that once for its 30-day window).
ALTER TABLE improvement_submissions
  ADD COLUMN IF NOT EXISTS credit_weight SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS credit_weight_set_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS credit_weight_set_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'improvement_submissions_credit_weight_check'
  ) THEN
    ALTER TABLE improvement_submissions
      ADD CONSTRAINT improvement_submissions_credit_weight_check CHECK (credit_weight BETWEEN 1 AND 3);
  END IF;
END $$;

ALTER TABLE planday_shifts_cache ADD COLUMN IF NOT EXISTS status TEXT;
