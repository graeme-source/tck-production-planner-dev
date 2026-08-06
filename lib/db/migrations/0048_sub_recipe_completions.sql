-- Base sub-recipe production completions (2026-08-06)
--
-- The Bases & Sauces prep station's base card (Tomato Base) runs a make flow
-- (stock check → auto-batches → ingredient checklist) whose "done" state
-- lived only in React component state: a page refresh lost it, and the base
-- never counted toward the station's prep progress. This table persists
-- "this plan's base production is complete" per sub-recipe — written either
-- by the direct tick on the station page or by finishing the make flow.
--
-- `batches` records how many batches were actually made (0 when existing
-- stock covered the requirement). Nullable: a direct tick doesn't ask.
--
-- Applied at boot by runStartupMigrations() in artifacts/api-server/src/index.ts
-- (idempotent CREATE TABLE IF NOT EXISTS); this file is the reference copy.

CREATE TABLE IF NOT EXISTS sub_recipe_completions (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  sub_recipe_id INTEGER NOT NULL REFERENCES sub_recipes(id) ON DELETE CASCADE,
  batches NUMERIC(10,2),
  user_id INTEGER REFERENCES app_users(id),
  completed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sub_recipe_completion UNIQUE (plan_id, sub_recipe_id)
);
