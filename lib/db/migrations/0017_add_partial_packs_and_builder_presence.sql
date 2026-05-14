-- Migration: Race-safe building completion
--
-- 1. partial_packs on batch_completions — records the pack count for a batch
--    slot that ended short (e.g. final batch ran out of filling). Null = full
--    batch contributing packsPerBatch packs.
-- 2. correction_by_user_id / correction_note — audit trail for "Add missed
--    batch" admin rectifications on already-closed recipes.
-- 3. builder_presence — live ping per (plan_item_id, station_type) used by
--    the Mark Recipe Complete action to refuse closing a recipe while the
--    other builder is still mid-batch on it.
--
-- Note: this project uses `drizzle-kit push` for DDL. This file mirrors the
-- updated schema in lib/db/src/schema/production_plans.ts.

ALTER TABLE batch_completions
  ADD COLUMN IF NOT EXISTS partial_packs integer;

ALTER TABLE batch_completions
  ADD COLUMN IF NOT EXISTS correction_by_user_id integer REFERENCES app_users(id) ON DELETE SET NULL;

ALTER TABLE batch_completions
  ADD COLUMN IF NOT EXISTS correction_note text;

CREATE TABLE IF NOT EXISTS builder_presence (
  id serial PRIMARY KEY,
  plan_item_id integer NOT NULL REFERENCES production_plan_items(id) ON DELETE CASCADE,
  station_type text NOT NULL,
  user_id integer REFERENCES app_users(id) ON DELETE SET NULL,
  last_seen_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_builder_presence UNIQUE (plan_item_id, station_type)
);
