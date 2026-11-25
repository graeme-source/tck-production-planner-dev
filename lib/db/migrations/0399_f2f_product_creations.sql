-- "Create F2F product" from a recipe (Graeme, 25 Nov 2026): duplicate the
-- recipe's main Shopify product as "F2F - <main title>" (the frozen copy that
-- freezer stock goes onto), with the F2F tag set, then link it to the recipe
-- (recipes.f2f_variant_id, migration 0397).
--
-- One row per recipe: who made it and what happened. It is also the guard:
--   - the run CLAIMS the row (state 'creating') before anything is sent, so
--     a double tap can't make two products;
--   - the new product's id is stored the moment Shopify returns it, so a
--     run that fails part-way is FINISHED by the next run, never duplicated.
--
--   state  'creating' | 'created' (duplicated, not finished) | 'complete' | 'failed'
--
-- Rules: api-server lib/f2f-product-rules.ts; run: lib/f2f-product.ts.
-- Objective C. Safe to run twice.

CREATE TABLE IF NOT EXISTS f2f_product_creations (
  id                  SERIAL PRIMARY KEY,
  recipe_id           INTEGER NOT NULL UNIQUE REFERENCES recipes(id) ON DELETE CASCADE,
  main_product_id     TEXT,
  shopify_product_id  TEXT,
  product_title       TEXT,
  linked_variant_id   TEXT,
  state               TEXT NOT NULL DEFAULT 'creating'
                      CHECK (state IN ('creating', 'created', 'complete', 'failed')),
  last_error          TEXT,
  steps               JSONB,
  created_by_id       INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name     TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
