-- Migration: Add requires_use_by_date flag on ingredients; seed defaults.
--
-- A per-ingredient boolean controls whether goods-in requires a use-by date.
-- Defaults to FALSE so most items no longer need a date at receiving.
-- A one-time seed marks all raw meats as requiring a date, and gives
-- every vegetable (with no existing shelf-life) a default shelf life of 5 days
-- so its use-by auto-calculates at goods-in.
--
-- Startup migrations in artifacts/api-server/src/index.ts actually apply this
-- (idempotent ADD COLUMN IF NOT EXISTS + a _migrations_done gate on the seed).
-- This file mirrors the schema in lib/db/src/schema/ingredients.ts for reference.

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS requires_use_by_date BOOLEAN NOT NULL DEFAULT FALSE;

-- One-time seed: run only if not already recorded.
INSERT INTO _migrations_done (key)
SELECT 'requires_use_by_date_seed_v1'
WHERE NOT EXISTS (SELECT 1 FROM _migrations_done WHERE key = 'requires_use_by_date_seed_v1');

UPDATE ingredients SET requires_use_by_date = TRUE WHERE category = 'raw_meat';
UPDATE ingredients SET shelf_life_days = 5 WHERE category = 'vegetable' AND shelf_life_days IS NULL;
