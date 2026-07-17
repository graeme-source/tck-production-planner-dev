-- 0026: per-plan extra/test dough
--
-- Ad-hoc dough added to a specific production day from the plan detail page
-- (e.g. test dough for a recipe trial). Surfaced on the dough station's
-- balling view and included in the mixing totals for the day that preps this
-- plan's dough. Distinct from the GLOBAL daily extra/snack balls, which live
-- in app_settings and apply to every day.
--
-- NOTE: as with all migrations in this folder, this file documents the change;
-- the authoritative applied-on-deploy copy is in runStartupMigrations()
-- (artifacts/api-server/src/index.ts).

CREATE TABLE IF NOT EXISTS production_plan_extra_dough (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Test dough',
  ball_count INTEGER NOT NULL,
  ball_weight_g INTEGER NOT NULL,
  created_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
