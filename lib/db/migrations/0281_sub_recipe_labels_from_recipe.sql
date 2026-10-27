-- Pot labels print the product recipe's PUBLISHED label (Graeme, 27 Oct
-- 2026: "I don't want to have different versions"). Objectives D and F.
--
-- sub_recipe_product_labels (0272) carried its own name, use-by and barcode
-- for the TCK Garlic Mayo pots — a second design beside the recipe's label.
-- Now each row points at the product recipe whose live label prints
-- (recipe_id); the name, use-by and barcode come from that recipe's label
-- page (template "Garlic mayo", 102 x 25 mm, migration 0280). pot_size_g
-- stays: it suggests how many labels a batch needs.
--
-- The old label_name / use_by_days / barcode_variant_id columns are no
-- longer read. They are made nullable rather than dropped, so nothing is
-- lost and the change can be undone; a later release may drop them.
--
-- Sub-recipe 66 "TCK Garlic Mayo" -> recipe 31 "TCK Garlic Mayo 200ml",
-- only while both names still match. Safe to run twice.

ALTER TABLE sub_recipe_product_labels
  ADD COLUMN IF NOT EXISTS recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL;

ALTER TABLE sub_recipe_product_labels ALTER COLUMN label_name DROP NOT NULL;
ALTER TABLE sub_recipe_product_labels ALTER COLUMN use_by_days DROP NOT NULL;

UPDATE sub_recipe_product_labels l
   SET recipe_id = r.id, updated_at = NOW()
  FROM recipes r, sub_recipes s
 WHERE l.sub_recipe_id = 66 AND s.id = 66 AND s.name = 'TCK Garlic Mayo'
   AND r.id = 31 AND r.name ILIKE 'TCK Garlic Mayo%'
   AND l.recipe_id IS NULL;
