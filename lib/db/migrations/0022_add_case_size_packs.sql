-- Migration: Add case_size_packs on ingredients.
--
-- Number of packs that make up one supplier case (e.g. 12 tins of tomato paste
-- to a case). When set, the orders page rounds the pack count to order UP to
-- the nearest whole case — so needing 8 tins with a case size of 12 orders 12.
-- Null means "order in individual packs"; no case rounding is applied.
--
-- Stock check is deliberately unaffected — this only changes the ordering
-- quantity. Startup migrations in artifacts/api-server/src/index.ts apply this
-- (idempotent ADD COLUMN IF NOT EXISTS). This file mirrors the schema in
-- lib/db/src/schema/ingredients.ts for reference.

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS case_size_packs INTEGER;
