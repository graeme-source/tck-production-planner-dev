-- Use-by date on a stock check (fix-queue #165 — Jane asked for it on milk
-- and cream at the prep station; Graeme approved 22 Oct 2026). Objective D
-- (food safety) via C (stock you can trust).
--
--   daily_stock_checks.use_by_date   optional; only offered for ingredients
--       with "Require use-by date" ticked. The stock-check entry warns when
--       it's today or already past. NULL = not given. A re-count of the
--       same item on the same day keeps it unless a new one is entered.
--
-- Saved by PUT /api/stock-check-use-by (its own route — production-plans.ts
-- takes no new code), after the count itself is saved.

ALTER TABLE daily_stock_checks ADD COLUMN IF NOT EXISTS use_by_date DATE;
