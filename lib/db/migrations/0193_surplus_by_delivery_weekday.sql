-- Ordering: surplus by delivery day (Graeme, 2026-10-14). Objective C.
--
--   ingredients.surplus_by_delivery_weekday  jsonb map of ISO weekday
--       (1 = Mon … 7 = Sun) → surplus % for deliveries ARRIVING that day,
--       e.g. {"1":130,"2":130,"3":130,"4":30,"5":30}. NULL (every existing
--       row) or a missing day = the ingredient's normal surplus_percent, so
--       nothing changes until someone switches it on for an ingredient.
--
-- The order day → delivery day mapping is not stored: it is worked out from
-- the supplier's lead time and cut-off, the same way the Orders page dates
-- deliveries (calcExpectedDeliveryDate).
--
-- Idempotent: re-running changes nothing. No backfill.

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS surplus_by_delivery_weekday JSONB;
