-- Migration: Add stock_in_packs flag on ingredients.
--
-- When true, this ingredient is counted in whole packs (e.g. bottles of milk,
-- jars of chutney) for stock check, ordering and goods-in receiving, rather
-- than in its native weight / volume unit. Recipes, prep and mixing still
-- operate in the native unit — this flag only affects supply-side UI.
-- Requires pack_weight > 0 to be set (enforced at save time by the API).
--
-- Default FALSE so existing ingredients keep their current behaviour.
-- Startup migrations in artifacts/api-server/src/index.ts apply this
-- (idempotent ADD COLUMN IF NOT EXISTS). This file mirrors the schema in
-- lib/db/src/schema/ingredients.ts for reference.

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS stock_in_packs BOOLEAN NOT NULL DEFAULT FALSE;
