-- Correct the Buttermilk Fried Chicken Strip marinade quantities
-- (Graeme, 2026-09-04).
--
-- The strip sub-recipe is set up per 44 g of chicken, and at that scale the
-- two smallest marinade lines were both entered as 0.0010 kg — a gram each,
-- the same number for lemon juice and for the spice mix. The four-year-old
-- manual production plan, and the marinade bottle recipe printed on it
-- (2 kg milk + 225 g lemon juice + 50 g spice mix), say they should be
-- 0.88 g and 0.195 g. The entry was rounded up to the nearest gram, which
-- put lemon 13% high and the spice mix at FIVE TIMES the real amount on
-- every prep sheet. Every other ratio in the sub-recipe matches the manual
-- plan to within 1%, which is how the error was pinned to data entry rather
-- than to the calculation method.
--
-- Corrected to the nearest representable value (the column is numeric(10,4)):
--   milk   0.0078 -> 0.0079   (manual plan says 0.0078844)
--   lemon  0.0010 -> 0.0009   (bottle recipe says 0.00088)
--   spice  0.0010 -> 0.0002   (bottle recipe says 0.000195)
--
-- The chicken quantity and the yield are untouched, so raw-meat-per-bag and
-- the run allocation do not move — only the marinade lines on the prep sheet.
--
-- Each UPDATE is guarded on the value it expects to find, so if the recipe
-- has been hand-corrected on live in the meantime this does nothing.

UPDATE sub_recipe_ingredients
SET quantity = 0.0079
WHERE sub_recipe_id = (SELECT id FROM sub_recipes WHERE name = 'Buttermilk Fried Chicken Strip')
  AND ingredient_id = (SELECT id FROM ingredients WHERE name = 'Whole Milk' LIMIT 1)
  AND quantity = 0.0078;

UPDATE sub_recipe_ingredients
SET quantity = 0.0009
WHERE sub_recipe_id = (SELECT id FROM sub_recipes WHERE name = 'Buttermilk Fried Chicken Strip')
  AND ingredient_id = (SELECT id FROM ingredients WHERE name = 'Lemon Juice' LIMIT 1)
  AND quantity = 0.0010;

-- The spice mix hangs off the strip as a nested sub-recipe, not an ingredient.
UPDATE sub_recipe_sub_recipes
SET quantity = 0.0002
WHERE sub_recipe_id = (SELECT id FROM sub_recipes WHERE name = 'Buttermilk Fried Chicken Strip')
  AND component_sub_recipe_id = (SELECT id FROM sub_recipes WHERE name = 'Marinade Spice Mix')
  AND quantity = 0.0010;
