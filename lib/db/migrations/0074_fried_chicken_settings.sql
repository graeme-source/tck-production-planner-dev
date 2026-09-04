-- Fried chicken production settings (Graeme, 2026-09-03).
--
-- The run is driven by kilos of RAW CHICKEN, the way calzones are driven by
-- batches — 75 kg is the usual week, editable whenever a plan is created.
--
-- The oil figure is what has to be ON SITE to fry with, per kg of chicken. It
-- is not what ends up in the food (that is already in the recipe); most of it
-- ends the day as waste. 0.457 is the sheet's own ratio: 34.2 kg of oil for
-- 74.771 kg of chicken.
--
-- Prep runs the day BEFORE production, so a Monday production shows its
-- chicken prep on Sunday's plan alongside the dough.
INSERT INTO app_settings (key, value, updated_at)
VALUES
  ('fried_chicken_default_raw_kg', '75',    NOW()),
  ('fried_chicken_oil_kg_per_kg',  '0.457', NOW()),
  ('fried_chicken_prep_days_before', '1',   NOW()),
  -- Trailing window used to work out each variant's share of the run. Blank
  -- DPT overrides mean "use the sales".
  ('fried_chicken_sales_window_days', '30', NOW())
ON CONFLICT (key) DO NOTHING;
