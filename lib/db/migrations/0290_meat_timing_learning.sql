-- Self-correcting prep-oven timings (Graeme, 27 Oct 2026). Objectives C, D, G.
--
-- "We've got this cooking time, processing time, and I sort of like grace
-- time... That should basically get everything ready in time for the bit
-- when the builders need the filling mix, but not too early."
--
--   ingredients.meat_grace_minutes  Minutes the cooked meat may sit READY
--       before the builders need it — cover for the slower days. The day
--       schedule's lead is cook + processing + grace. NULL = 0 (as before).
--   ingredients.meat_timing_auto_learn  When TRUE (default) the daily
--       learning run may move processing and grace from floor history.
--       A manager reverting a change turns it off for that meat, so the
--       learner doesn't put it straight back.
--
--   meat_timing_adjustments  One row per change to processing or grace,
--       automatic or by hand: old → new, why, how many runs it was based on
--       and the spread. Reverting stamps reverted_at and writes the old
--       value back. Cook time is never in here: learning never changes it.
--
-- Settings (app_settings), only if not already set:
--   cooked_meat_max_hold_minutes  Oven-out → recipe's last batch built. The
--       4-hour rule less a 30-minute margin = 210.
--   meat_timing_learning_enabled  'true' — the daily automatic run.
--   meat_put_in_reason_minutes  Put in further than this from the suggested
--       time → the station asks why. 10.
--
-- Additive only; idempotent. No existing values are changed.

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS meat_grace_minutes INTEGER;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS meat_timing_auto_learn BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS meat_timing_adjustments (
  id SERIAL PRIMARY KEY,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  -- Copied so the log reads right after a rename.
  ingredient_name TEXT NOT NULL,
  field TEXT NOT NULL CHECK (field IN ('process', 'grace')),
  old_value INTEGER,
  new_value INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('auto', 'manual', 'revert')),
  reason TEXT NOT NULL,
  runs_used INTEGER,
  lead_median_minutes NUMERIC(7, 1),
  lead_slow_minutes NUMERIC(7, 1),
  actor_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  actor_name TEXT,
  reverted_at TIMESTAMPTZ,
  reverted_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS meat_timing_adjustments_ingredient_idx
  ON meat_timing_adjustments (ingredient_id, created_at DESC);

-- meat_put_in_records  The daily review (Graeme's addition, 27 Oct 2026):
--     one row per raw meat x recipe x plan, created when the FIRST tray of
--     it goes into the prep oven.
--       suggested_at_minutes  the live "in the oven by" time the station was
--           showing at that moment (minutes since London midnight) — the
--           thing being judged; planned_at_minutes is the morning plan's.
--       deviation_minutes     put-in minus suggested (+ = late).
--       reason_*              the quick-pick "why?" when put in more than the
--           threshold away from the suggestion.
--     Filled by the daily review after production:
--       ready_at_minutes      first tin of the filling mixed;
--       needed_at_minutes     when the builders were free for the recipe;
--       outcome   'perfect' | 'builders_waited' | 'too_early' | 'unknown'
--       cause     'none' | 'model' | 'human' | 'capacity' | 'unknown'
CREATE TABLE IF NOT EXISTS meat_put_in_records (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  plan_date DATE NOT NULL,
  recipe_id INTEGER NOT NULL,
  recipe_name TEXT NOT NULL,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  ingredient_name TEXT NOT NULL,
  suggested_at_minutes INTEGER,
  planned_at_minutes INTEGER,
  lead_minutes INTEGER,
  put_in_at TIMESTAMPTZ NOT NULL,
  put_in_minutes INTEGER NOT NULL,
  deviation_minutes INTEGER,
  reason_code TEXT,
  reason_note TEXT,
  reason_by_name TEXT,
  reason_at TIMESTAMPTZ,
  ready_at_minutes INTEGER,
  needed_at_minutes INTEGER,
  outcome TEXT,
  cause TEXT,
  followed BOOLEAN,
  wait_minutes INTEGER,
  sat_minutes INTEGER,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, recipe_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS meat_put_in_records_ingredient_idx
  ON meat_put_in_records (ingredient_id, plan_date DESC);

INSERT INTO app_settings (key, value) VALUES
  ('cooked_meat_max_hold_minutes', '210'),
  ('meat_timing_learning_enabled', 'true'),
  ('meat_put_in_reason_minutes', '10')
ON CONFLICT (key) DO NOTHING;
