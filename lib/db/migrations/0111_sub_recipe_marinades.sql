-- Marinade links inside sub-recipes (Graeme, 2026-09-17).
--
-- A cooked-down component (the Philly slow-cook beef, the Mexican box's
-- chilli) belongs in a sub-recipe with a yield %, but until now the
-- marinade machinery — the raw-meat station's marinade panel, prep-sheet
-- placement, mixing marinade grams and the add-at-cooking gate — only read
-- recipe-level rows, so restructuring lost the grouping. These columns are
-- the same marinade fields recipe components carry, one level down.
ALTER TABLE sub_recipe_ingredients ADD COLUMN IF NOT EXISTS marinade_for_ingredient_id integer REFERENCES ingredients(id) ON DELETE SET NULL;
ALTER TABLE sub_recipe_ingredients ADD COLUMN IF NOT EXISTS marinade_add_at_cooking boolean NOT NULL DEFAULT false;
ALTER TABLE sub_recipe_sub_recipes ADD COLUMN IF NOT EXISTS marinade_for_ingredient_id integer REFERENCES ingredients(id) ON DELETE SET NULL;
ALTER TABLE sub_recipe_sub_recipes ADD COLUMN IF NOT EXISTS marinade_add_at_cooking boolean NOT NULL DEFAULT false;
