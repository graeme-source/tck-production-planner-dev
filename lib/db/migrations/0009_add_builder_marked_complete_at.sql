-- Migration: Add builder_marked_complete_at to production_plan_items
--
-- Lets the Building station builder explicitly mark a recipe as complete
-- before hitting batchesTarget (e.g. ran out of filling). When set, downstream
-- stations (ovens, wrapping) treat the builder's current batch count as the
-- new effective target, and net pack output becomes
-- `batchesComplete × packsPerBatch + extraPacksBuilt` — no more reliance on
-- the subtractive `short_count` path.
--
-- Note: this project uses `drizzle-kit push` (schema-driven) for DDL. This
-- file mirrors the updated schema in lib/db/src/schema/production_plans.ts.

ALTER TABLE production_plan_items
  ADD COLUMN IF NOT EXISTS builder_marked_complete_at timestamp;
