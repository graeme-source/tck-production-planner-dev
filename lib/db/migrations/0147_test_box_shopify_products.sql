-- Test boxes → Shopify draft products (Graeme, 2026-10-02). Objectives A (a
-- trial recipe gets its Shopify product, linked to the planner so its sales
-- drive production, in one sitting) and I (the launch checklist does itself).
--
-- What the app remembers, so running "Create Shopify products" again UPDATES
-- what it made instead of duplicating it:
--   test_box_shopify_products  one row per (box, recipe) the app created a
--                              Shopify product for — written straight after
--                              Shopify's productDuplicate returns, so a run
--                              that fails part-way still knows the product.
--   test_boxes.shopify_collection_id  the box's smart collection (rule: tag =
--                              box name), created once per box.
--   test_boxes.discount_code / shopify_discount_id / discount_ends_on  the
--                              box's 20% code, created once per box.
-- Ids are Shopify's numeric ids as text (same as recipe_shopify_mappings).
-- The recipe → variant link itself lives in recipe_shopify_mappings, as for
-- every other product; this table is only "the app made this one".

CREATE TABLE IF NOT EXISTS test_box_shopify_products (
  id SERIAL PRIMARY KEY,
  test_box_id INTEGER NOT NULL REFERENCES test_boxes(id) ON DELETE CASCADE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  shopify_product_id TEXT NOT NULL,
  product_title TEXT,
  template_product_id TEXT,
  images_copied BOOLEAN NOT NULL DEFAULT TRUE,
  -- 'created' (duplicated, details not all written yet) | 'complete'
  state TEXT NOT NULL DEFAULT 'created',
  last_error TEXT,
  created_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  updated_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (test_box_id, recipe_id)
);

ALTER TABLE test_boxes ADD COLUMN IF NOT EXISTS shopify_collection_id TEXT;

-- The box's one shared 20% code (e.g. CCOCT26-7K2P9Q), made by the
-- "Create the 20% discount code" step, and Shopify's id for it.
ALTER TABLE test_boxes ADD COLUMN IF NOT EXISTS discount_code TEXT;
ALTER TABLE test_boxes ADD COLUMN IF NOT EXISTS shopify_discount_id TEXT;
ALTER TABLE test_boxes ADD COLUMN IF NOT EXISTS discount_ends_on DATE;
