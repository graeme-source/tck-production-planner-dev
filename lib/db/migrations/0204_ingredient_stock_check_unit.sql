-- The unit each item is stock-checked in (Graeme, 19 Oct 2026). Objective F.
--
-- "You have to add a number of whole packs and then a fraction of any
-- additional packs, which is confusing." Every stock check now says which
-- unit it is recorded in ("This stock check must be recorded in KILOGRAMS"),
-- then takes one number in that unit.
--
-- ingredients.stock_check_unit   'g' | 'kg' | 'packs' | 'native'
--                                NULL = the default rule
--                                (lib/units/src/stock-check-unit.ts):
--                                stock_in_packs → packs; g/ml → grams;
--                                kg/l → kilograms; count units → their own.
--                                Set on the ingredient form (autosaves).
--
-- What's STORED is unchanged: daily_stock_checks.quantity stays in the
-- ingredient's own unit; the entered number is converted before saving.
-- No data change — every row starts on the default rule.
-- Idempotent: re-running changes nothing.

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS stock_check_unit TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingredients_stock_check_unit_check') THEN
    ALTER TABLE ingredients ADD CONSTRAINT ingredients_stock_check_unit_check
      CHECK (stock_check_unit IS NULL OR stock_check_unit IN ('g', 'kg', 'packs', 'native'));
  END IF;
END $$;
