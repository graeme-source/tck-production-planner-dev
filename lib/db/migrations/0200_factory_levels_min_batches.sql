-- Factory-number levels + the fewest batches a day (Graeme, 2026-10-16).
-- Objective C (never run out, never freeze) and I (a full team isn't left
-- under-used).
--
-- "The 1,000-pack ceiling isn't a hard ceiling — it's a legacy ceiling.
-- Replace it with our new levels: target 800–1,000; too low is under 500;
-- warning at 1,250; too high (we're freezing) at 1,500." … "We'll make a
-- minimum of about 80 batches, never less really."
--
-- The ceiling itself was code, not a setting (removed from the Create Plan
-- screen). The levels live in app_settings as factory_forecast_*; the code
-- defaults are already these numbers, so a key that was never saved needs
-- nothing. This sets any SAVED level to the numbers Graeme approved:
--   factory_forecast_target_low   800
--   factory_forecast_target_high  1000
--   factory_forecast_warn_at      1250
--   factory_forecast_max_at       1500
--   factory_forecast_low_red      500
--   factory_forecast_low_amber    (not named by Graeme — kept, unless it no
--                                  longer sits between 500 and 800, then 600)
-- and adds the fewest batches a day (factory_min_batches_per_day = 80),
-- editable under Change levels.
--
-- Idempotent: re-running leaves the same values.

UPDATE app_settings SET value = '800',  updated_at = NOW() WHERE key = 'factory_forecast_target_low';
UPDATE app_settings SET value = '1000', updated_at = NOW() WHERE key = 'factory_forecast_target_high';
UPDATE app_settings SET value = '1250', updated_at = NOW() WHERE key = 'factory_forecast_warn_at';
UPDATE app_settings SET value = '1500', updated_at = NOW() WHERE key = 'factory_forecast_max_at';
UPDATE app_settings SET value = '500',  updated_at = NOW() WHERE key = 'factory_forecast_low_red';

UPDATE app_settings SET value = '600', updated_at = NOW()
 WHERE key = 'factory_forecast_low_amber'
   AND CASE WHEN value ~ '^[0-9]{1,6}$' THEN value::int NOT BETWEEN 500 AND 800 ELSE TRUE END;

INSERT INTO app_settings (key, value)
VALUES ('factory_min_batches_per_day', '80')
ON CONFLICT (key) DO NOTHING;
