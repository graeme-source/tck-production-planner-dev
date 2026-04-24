-- Migration: allow miscellaneous order lines (no ingredient row).
--
-- Operators occasionally need to order one-off items (samples, packaging
-- trials, etc.) that aren't worth creating a full ingredient record for,
-- but still want them tracked on the PO so they can be checked off at
-- goods-in. We relax the FK constraint on purchase_order_lines.ingredient_id
-- and add a description column that's populated for those misc lines
-- alongside the existing unit and quantity fields.
--
-- Startup migrations in artifacts/api-server/src/index.ts apply these
-- (idempotent). This file mirrors the schema in lib/db/src/schema/ordering.ts.

ALTER TABLE purchase_order_lines
  ALTER COLUMN ingredient_id DROP NOT NULL;

ALTER TABLE purchase_order_lines
  ADD COLUMN IF NOT EXISTS description TEXT;
