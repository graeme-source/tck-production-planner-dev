-- F2F (frozen) product link per recipe (Graeme, 25 Nov 2026): every core
-- recipe has an "F2F - …" product on Shopify that costs exactly what the
-- recipe costs. Linking it makes the profit figures use the recipe's cost
-- (not Shopify's cost per item, which for some included labour) and is what
-- the fridge → freezer move will add stock to. One F2F product per recipe;
-- a Shopify variant is the F2F of at most one recipe. Safe to run twice.
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS f2f_variant_id TEXT;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS f2f_product_title TEXT;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS f2f_variant_title TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS recipes_f2f_variant_id_key ON recipes (f2f_variant_id) WHERE f2f_variant_id IS NOT NULL;
