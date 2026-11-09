-- How a raw meat is portioned at the Raw Meat station (Graeme, 9 Nov 2026,
-- Fix queue #396). Objective B.
--   counts_toward_slow_meat  false = left out of the slow-meat oven limit
--                            (pork now cooks overnight at a different time)
--   meat_portion_container   'tray' or 'bag': the word the station uses
--   meat_portion_breakdown   false = no per-tray/bag split; the station shows
--                            the total meat, rub and sauce and one tick
-- Safe to run twice.

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS counts_toward_slow_meat BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS meat_portion_container TEXT NOT NULL DEFAULT 'tray';
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS meat_portion_breakdown BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingredients_meat_portion_container_check') THEN
    ALTER TABLE ingredients ADD CONSTRAINT ingredients_meat_portion_container_check CHECK (meat_portion_container IN ('tray', 'bag'));
  END IF;
END $$;

-- Graeme's settings for pork on #396: out of the slow-meat count, 3 kg bags.
UPDATE ingredients
   SET counts_toward_slow_meat = FALSE, meat_portion_container = 'bag', raw_meat_tray_capacity_kg = 3
 WHERE id = 22 AND name = 'Pork' AND category = 'raw_meat' AND meat_portion_container = 'tray';
