-- Cook-and-chill records for cooked sub-recipes (issue #244, approved
-- 2026-10-22). Objective D (HACCP compliance and SALSA-ready records).
--
-- "Please can we have a place to record garlic confit and garlic butter
-- temperature when cooked and record going in blast chiller and add onto
-- wrapping for chilling time finished" (Jane).
--
--   sub_recipes.cook_chill_required  The tick box on the sub-recipe that
--       says "this is cooked and must be cooled". Which sub-recipes need it
--       is data, never a name in code. FALSE for every existing row.
--
--   cook_chill_records  One row per cooked batch:
--       cook_temp_c + cook_held_for_seconds  core temperature at cook-out and
--           how long it held, judged against the same FSA time/temperature
--           table as the Mac Cheese station (70°C/2 min = 75°C/30 s), never a
--           fixed 75°C.
--       chill_start_at  "Into blast chiller".
--       chill_end_at    "Chilling finished" (ticked on Wrapping or Prep).
--       chilled_via     'prep_station' | 'wrapping_station'.
--   Cooling is the same start/finish/who/where shape as the calzone chill
--   timer (batch_weight_records.chill_end_at, #85), so both report as one
--   cooling log.
--
--   The sub-recipe's name is copied onto the row so the record survives a
--   rename or removal (HACCP history must not change after the event).
--
-- Additive only; idempotent. No data is changed.

ALTER TABLE sub_recipes ADD COLUMN IF NOT EXISTS cook_chill_required BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS cook_chill_records (
  id SERIAL PRIMARY KEY,
  sub_recipe_id INTEGER REFERENCES sub_recipes(id) ON DELETE SET NULL,
  sub_recipe_name TEXT NOT NULL,
  -- The plan the prep screen was on (context only; the prep room works on
  -- tomorrow's plan, Wrapping on today's).
  plan_id INTEGER REFERENCES production_plans(id) ON DELETE SET NULL,
  cook_temp_c NUMERIC(5, 1) NOT NULL,
  cook_held_for_seconds INTEGER NOT NULL,
  cooked_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  cooked_by_name TEXT NOT NULL,
  cooked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  chill_start_at TIMESTAMP,
  chill_start_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  chill_start_by_name TEXT,
  chill_end_at TIMESTAMP,
  chill_end_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  chill_end_by_name TEXT,
  chilled_via TEXT
);

CREATE INDEX IF NOT EXISTS cook_chill_records_cooked_at_idx ON cook_chill_records (cooked_at);
-- The Wrapping and Prep cards read "still chilling" rows.
CREATE INDEX IF NOT EXISTS cook_chill_records_open_idx ON cook_chill_records (chill_end_at) WHERE chill_end_at IS NULL;
