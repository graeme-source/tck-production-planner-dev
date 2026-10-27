-- Pot labels for sub-recipes we sell as they are (Graeme, 27 Oct 2026):
-- "This is our TCK garlic mayo label... we just put this on our TCK garlic
-- mayos that we make up." Printed from the iPad at the end of making the
-- sub-recipe, one per pot. Objectives A and F.
--
-- One row per sub-recipe that gets a label: the name printed, the use-by
-- (days from printing), the Shopify variant whose barcode goes on it, and
-- the pot size used to suggest how many labels a batch needs.

CREATE TABLE IF NOT EXISTS sub_recipe_product_labels (
  sub_recipe_id INTEGER PRIMARY KEY REFERENCES sub_recipes(id) ON DELETE CASCADE,
  label_name TEXT NOT NULL,
  use_by_days INTEGER NOT NULL CHECK (use_by_days BETWEEN 1 AND 365),
  barcode_variant_id TEXT,
  pot_size_g NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TCK Garlic Mayo: the label printed 27 Oct 2026 read USE BY 04/12/26 (38
-- days), barcode 97748478844497 = Shopify "TCK Garlic Mayo" variant
-- 31277638844497, 200 ml pots. Only if that sub-recipe exists by that name.
INSERT INTO sub_recipe_product_labels (sub_recipe_id, label_name, use_by_days, barcode_variant_id, pot_size_g)
SELECT id, 'TCK Garlic Mayo', 38, '31277638844497', 200
  FROM sub_recipes WHERE id = 66 AND name = 'TCK Garlic Mayo'
ON CONFLICT (sub_recipe_id) DO NOTHING;
