-- Dough mix progress for SAME-DAY dough too (Graeme, 2026-10-12). Objective C.
--
-- 0176 saved the day-before (calzone) dough's mix ticks. The same-day dough
-- cards on the Dough Prep station (doughs flagged made_on_production_day,
-- e.g. cinnamon bun dough) still kept theirs only in the iPad's memory, so
-- a reload or a second iPad lost them. They go in the same table, told
-- apart by dough_key:
--   'day_before'      — the day-before dough (every existing row)
--   'same_day:<id>'   — one same-day dough, by its sub-recipe id; plan_id
--                       is the plan it is baked for (made that same day)
-- The primary key widens to (plan_id, dough_key, mix_no) so both doughs can
-- have a "Mix 1" on the same plan.
ALTER TABLE dough_mix_progress
  ADD COLUMN IF NOT EXISTS dough_key TEXT NOT NULL DEFAULT 'day_before';

ALTER TABLE dough_mix_progress DROP CONSTRAINT IF EXISTS dough_mix_progress_dough_key_check;
ALTER TABLE dough_mix_progress
  ADD CONSTRAINT dough_mix_progress_dough_key_check
  CHECK (dough_key ~ '^(day_before|same_day:[0-9]+)$');

ALTER TABLE dough_mix_progress DROP CONSTRAINT IF EXISTS dough_mix_progress_pkey;
ALTER TABLE dough_mix_progress ADD PRIMARY KEY (plan_id, dough_key, mix_no);
