-- Per-recipe oven setting override (kitchen request, Kerri-Leigh 2026-09-15).
--
-- Every recipe bakes at its dietary profile's standard — the meat / veg
-- defaults in app_settings (oven_meat_temp_c / oven_meat_time_min and the
-- veg pair). A few recipes over-cook at the standard and need a different
-- setting, e.g. 200°C for 6:00. These two columns hold that exception; the
-- building station shows an unmissable "oven change" reminder whenever the
-- recipe being built differs from its profile's standard.
--
--   oven_temp_c        °C for this recipe; NULL = use the profile standard
--   oven_time_seconds  bake time in seconds (6:00 = 360); NULL = standard
--
-- Deliberately no values set here: which recipes need an override is data
-- entered on the recipe form, never baked into a migration.

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS oven_temp_c integer;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS oven_time_seconds integer;
