-- UPF % on the website, from the planner (Graeme, 22 Oct 2026). Objective B
-- (the product we sell is honestly described) — and the planner stays the
-- single source of truth for what is in a recipe.
--
-- "I need this to be automatic by having a source of truth in my TCK
-- production planner... I'm constantly going to be removing UPF ingredients
-- from the recipe, so we need to push from the planner to the website
-- systematically and automatically."
--
-- Every few minutes the api-server works out each recipe's UPF % (the same
-- rollup as the Recipes page) and writes it to the linked Shopify product's
-- metafield custom.upf_percent, which the theme shows under the card photo.
-- A recipe with any unclassified ingredient is held back (the metafield is
-- removed) so the website never shows a number the planner marks with "?".
--
-- One row per Shopify product we have decided about. published_percent is
-- what we last wrote to Shopify (NULL = we removed it / it isn't there), so a
-- cycle only writes products whose number actually changed.

CREATE TABLE IF NOT EXISTS upf_shopify_sync (
  product_gid       TEXT PRIMARY KEY,
  product_title     TEXT,
  recipe_names      TEXT,
  -- published | held_unclassified | held_no_data | held_several_recipes | unlinked
  status            TEXT NOT NULL,
  upf_percent       NUMERIC(5,1),
  published_percent NUMERIC(5,1),
  unclassified      TEXT,
  last_error        TEXT,
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  written_at        TIMESTAMPTZ
);
