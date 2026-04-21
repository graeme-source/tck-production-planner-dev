-- Migration: Add batch_weight_records + tray/chill app_settings defaults
--
-- Oven-station batch weight log. Every oven batch gets a row recording the
-- actual pack weight, the computed target (tray + pack_size × portion), and
-- the variance. The final batch for a recipe flips is_last_batch_of_recipe
-- and its recorded_at is the chill-start timestamp. chill_end_at is stamped
-- by the Mark as Chilled button on the oven or wrapping station (and, as a
-- fallback, when wrapping-complete fires).
--
-- Note: this project uses startup migrations in artifacts/api-server/src/index.ts
-- (idempotent CREATE TABLE IF NOT EXISTS). This file mirrors the schema in
-- lib/db/src/schema/production_plans.ts for reference only.

CREATE TABLE IF NOT EXISTS batch_weight_records (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  plan_item_id INTEGER NOT NULL REFERENCES production_plan_items(id) ON DELETE CASCADE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  batch_sequence INTEGER NOT NULL,
  tray_weight_g NUMERIC(7,2) NOT NULL,
  portion_weight_g NUMERIC(7,2) NOT NULL,
  pack_size INTEGER NOT NULL,
  target_weight_g NUMERIC(7,2) NOT NULL,
  actual_weight_g NUMERIC(7,2) NOT NULL,
  variance_g NUMERIC(7,2) NOT NULL,
  tolerance_under_g NUMERIC(7,2) NOT NULL DEFAULT 0,
  tolerance_over_g NUMERIC(7,2) NOT NULL DEFAULT 0,
  within_tolerance BOOLEAN NOT NULL,
  is_last_batch_of_recipe BOOLEAN NOT NULL DEFAULT FALSE,
  chill_end_at TIMESTAMP,
  chilled_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  chilled_via TEXT,
  user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bwr_plan_recipe
  ON batch_weight_records (plan_id, recipe_id);

CREATE INDEX IF NOT EXISTS idx_bwr_last_batch
  ON batch_weight_records (plan_id, recipe_id)
  WHERE is_last_batch_of_recipe = TRUE;

INSERT INTO app_settings (key, value, updated_at)
VALUES
  ('tray_weight_g', '36', NOW()),
  ('chill_target_temp_c', '4', NOW()),
  ('weight_tolerance_under_g', '0', NOW()),
  ('weight_tolerance_over_g', '0', NOW())
ON CONFLICT (key) DO NOTHING;
