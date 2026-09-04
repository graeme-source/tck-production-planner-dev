-- Grouping ingredients on the prep sheet without inventing sub-recipes
-- (Graeme, 2026-09-04).
--
-- The fried chicken sheet is read in the order the job is done: the chicken,
-- then the breading you mix in a tub, then the marinade you mix in a bottle,
-- then the oil, then the Korean sauce. Two of those groups — "Flour + Breading
-- Mix" and "Buttermilk Marinade" — are real mixes the team makes up in
-- advance, but they are NOT modelled as sub-recipes, and Graeme's call is that
-- they shouldn't be: making them sub-recipes means maintaining a yield and
-- getting the quantity right in every top-level recipe that uses them, for a
-- grouping that is only ever about how the sheet READS.
--
-- So this is a display label, nothing more. prep_group says "show these rows
-- together under this heading"; prep_group_order says where that heading sits
-- in the list. Nothing in costing, allergens, spec sheets or the ingredient
-- resolver reads either column — quantities and totals are untouched.
--
-- It sits on the composition rows (which ingredient, in which sub-recipe)
-- rather than on the ingredient itself, because the same ingredient can belong
-- to different groups in different recipes: flour is part of the breading mix
-- here and plain flour somewhere else.

ALTER TABLE sub_recipe_ingredients
  ADD COLUMN IF NOT EXISTS prep_group TEXT,
  ADD COLUMN IF NOT EXISTS prep_group_order INTEGER;

-- Nested sub-recipes need it too: the Marinade Spice Mix is a sub-recipe in
-- its own right, and on this sheet it belongs inside the Buttermilk Marinade
-- group alongside the milk and the lemon juice.
ALTER TABLE sub_recipe_sub_recipes
  ADD COLUMN IF NOT EXISTS prep_group TEXT,
  ADD COLUMN IF NOT EXISTS prep_group_order INTEGER;

-- Ticking prep off as you go. Keyed by a stable step key rather than an
-- ingredient id, because a whole group ("Buttermilk Marinade") is one tick as
-- far as the person standing there is concerned, and prep_completions can't
-- express that — its recipe_id and tin_number are NOT NULL and mean nothing
-- for a station that has neither.
CREATE TABLE IF NOT EXISTS fried_chicken_prep_ticks (
  id           SERIAL PRIMARY KEY,
  plan_id      INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  step_key     TEXT    NOT NULL,
  completed_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  completed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, step_key)
);

CREATE INDEX IF NOT EXISTS fried_chicken_prep_ticks_plan_idx
  ON fried_chicken_prep_ticks (plan_id);

-- Seed the fried chicken groups to match the sheet the team already works to.
-- Matched by name within the one sub-recipe so this can't stray into another
-- recipe that happens to use flour. Re-runnable, and safe to edit afterwards.
UPDATE sub_recipe_ingredients sri
SET prep_group = v.grp, prep_group_order = v.pos
FROM (VALUES
  ('Chicken breast fillet strips', 'Chicken',              0),
  ('Plain Flour',                  'Flour + Breading Mix', 1),
  ('Spicy Breading',               'Flour + Breading Mix', 1),
  ('Whole Milk',                   'Buttermilk Marinade',  2),
  ('Lemon Juice',                  'Buttermilk Marinade',  2),
  ('Vegetable Oil',                'Oil',                  3)
) AS v(ing_name, grp, pos)
WHERE sri.sub_recipe_id = (SELECT id FROM sub_recipes WHERE name = 'Buttermilk Fried Chicken Strip')
  AND sri.ingredient_id = (SELECT id FROM ingredients WHERE name = v.ing_name LIMIT 1);

-- The spice mix goes in with the marinade it is stirred into.
UPDATE sub_recipe_sub_recipes ssr
SET prep_group = 'Buttermilk Marinade', prep_group_order = 2
WHERE ssr.sub_recipe_id = (SELECT id FROM sub_recipes WHERE name = 'Buttermilk Fried Chicken Strip')
  AND ssr.component_sub_recipe_id = (SELECT id FROM sub_recipes WHERE name = 'Marinade Spice Mix');
