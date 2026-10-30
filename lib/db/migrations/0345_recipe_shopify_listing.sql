-- "Create Shopify product" from a recipe (Graeme, 30 Oct 2026: "click in a
-- recipe, click 'Create Shopify product', and it sets up the product in
-- Shopify"). Objective A (a new recipe gets its Shopify product, linked to
-- the planner, in one sitting).
--
-- recipes.shopify_listing_description — the paragraph or two on the Shopify
--   product page (the product's description HTML): what the recipe is and
--   why it's special. Drafted with AI on the recipe's Details tab, reviewed
--   by Graeme. SEPARATE from recipes.description, which stays the short
--   recipe line written to the custom.product_recipe metafield.
-- recipe_product_images — one product photo per recipe (≥ 1000 × 750 px,
--   checked in the browser and again on the server from the image header),
--   inline bytea like the other photos in the app. Sent to the product's
--   media when the product is made.
-- recipe_shopify_products — the product the app made for a recipe, stored
--   the moment Shopify returns its id, so a failure part-way through can
--   never lead to a second duplicate (same idea as test_box_shopify_products).

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS shopify_listing_description TEXT;

CREATE TABLE IF NOT EXISTS recipe_product_images (
  recipe_id INTEGER PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
  data BYTEA NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  byte_size INTEGER NOT NULL,
  filename TEXT,
  uploaded_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  uploaded_by_name TEXT,
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recipe_shopify_products (
  recipe_id INTEGER PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
  shopify_product_id TEXT NOT NULL,
  product_title TEXT,
  template_product_id TEXT,
  -- created (duplicated, details not all written yet) | complete
  state TEXT NOT NULL DEFAULT 'created',
  last_error TEXT,
  created_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  updated_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
