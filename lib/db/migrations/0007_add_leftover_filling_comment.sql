-- Migration: Add leftover_filling_comment to production_plan_items
--
-- Lets builders record a free-text note alongside the leftover filling weight
-- at the end of a recipe (e.g. "ran dry", "under-portioned", etc).
--
-- Note: this project uses `drizzle-kit push` (schema-driven) for DDL. This
-- file mirrors the updated schema in lib/db/src/schema/production_plans.ts.

ALTER TABLE production_plan_items
  ADD COLUMN IF NOT EXISTS leftover_filling_comment text;
