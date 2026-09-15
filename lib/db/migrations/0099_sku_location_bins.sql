-- Bin locations become a real fridge map (Graeme, 2026-09-11): door number
-- + shelf letter per SKU, so the Bin Locations page can draw the fridge and
-- freezer as they stand (7 + 2 vertical doors, 5 shelves each) and the
-- picking order can walk door-by-door, shelf-by-shelf. location_label stays
-- as the display string ("3B") shown on pick rows.
ALTER TABLE sku_locations ADD COLUMN IF NOT EXISTS door integer;
ALTER TABLE sku_locations ADD COLUMN IF NOT EXISTS shelf text;
