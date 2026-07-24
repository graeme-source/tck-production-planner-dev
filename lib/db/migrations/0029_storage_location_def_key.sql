-- Migration: storage_locations — stable def_key identity for built-ins
--
-- The built-in fridges were matched to LOCATION_DEFS BY NAME, so renaming
-- one made it vanish from Stock Control AND the opening/closing temp
-- checks (def loop misses it, user loop filters is_system), and its
-- stock_entries (keyed e.g. 'raw_meat_fridge') orphaned under a locked
-- "Unknown" ghost row. def_key pins the identity to the row instead:
-- renames keep the same def key, stock key and visibility.
--
-- Backfill: name-matching system rows get their def key; system rows
-- whose names no longer match anything (renamed ghosts — live has two)
-- are normalised to user rows so they reappear in both UIs. Applied
-- idempotently at API startup (runStartupMigrations); the def loop lives
-- in code so LOCATION_DEFS stays the single source of truth. Equivalent
-- SQL:

ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS def_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS storage_locations_def_key_uq
  ON storage_locations (def_key) WHERE def_key IS NOT NULL;

-- One UPDATE per LOCATION_DEFS entry, e.g.:
-- UPDATE storage_locations SET def_key = 'raw_meat_fridge'
--  WHERE is_system AND def_key IS NULL AND lower(name) = 'raw meat fridge'
--    AND NOT EXISTS (SELECT 1 FROM storage_locations WHERE def_key = 'raw_meat_fridge');

-- Renamed system rows with no def match become ordinary user rows:
-- UPDATE storage_locations SET is_system = FALSE
--  WHERE is_system AND def_key IS NULL;
