-- Net quantity on product labels (Graeme, 2026-10-12, fried chicken).
-- Objective D (lawful, traceable labels).
--
-- product_label_settings.net_quantity — the net quantity printed as a big
-- bold line above the barcode, e.g. "500g", on templates that switch that
-- line on (the Fried chicken template). NULL = not set; the label then
-- lists "No net quantity" as a problem to fix before it can go live.
-- Recipes have no reliable pack-weight column to default from, so it is
-- typed per recipe.
ALTER TABLE product_label_settings ADD COLUMN IF NOT EXISTS net_quantity TEXT;
