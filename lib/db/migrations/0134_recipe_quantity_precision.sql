-- Recipe quantities to 3 decimal places of a gram (Graeme, 2026-09-29:
-- "our system only allows one decimal point … allow three"). Objective A
-- (recipes the kitchen can trust to the gram).
--
-- Quantities are stored in the ingredient's own unit. For anything measured
-- in kg, numeric(10,4) held only 0.0001 kg = 0.1 g, so 8.333 g of onion
-- powder saved as 8.3 g and 0.667 g-level spice amounts lost their tail.
-- numeric(14,6) holds 0.000001 kg = 0.001 g. Widening a numeric column
-- keeps every existing value exactly; nothing is rounded.

ALTER TABLE recipe_ingredients      ALTER COLUMN quantity TYPE numeric(14,6);
ALTER TABLE recipe_sub_recipes      ALTER COLUMN quantity TYPE numeric(14,6);
ALTER TABLE sub_recipe_ingredients  ALTER COLUMN quantity TYPE numeric(14,6);
ALTER TABLE sub_recipe_sub_recipes  ALTER COLUMN quantity TYPE numeric(14,6);
