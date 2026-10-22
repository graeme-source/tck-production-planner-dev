-- UPF %, calories and protein on the website, from the planner (Graeme,
-- 22 Oct 2026). Objective B (the product we sell is honestly described) — and
-- the planner stays the single source of truth for what is in a recipe.
--
-- "I need this to be automatic by having a source of truth in my TCK
-- production planner... I'm constantly going to be removing UPF ingredients
-- from the recipe, so we need to push from the planner to the website
-- systematically and automatically." Then: "a block that's got three icons
-- in it... UPF percentage, calories per portion, protein per portion."
--
-- Every 10 minutes the api-server works out each recipe's figures (the same
-- UPF rollup and nutrition panel as the Recipes page) and writes them to the
-- linked Shopify product's metafields — custom.upf_percent,
-- custom.kcal_per_portion, custom.protein_per_portion — which the theme
-- shows on the menu card. A figure the planner doubts (an unclassified
-- ingredient, an ingredient without kcal/protein) is held back: its
-- metafield is removed so the website shows nothing rather than a wrong
-- number.
--
-- One row per Shopify product we have decided about. *_published is what we
-- last wrote to Shopify (NULL = removed / not there), so a cycle only writes
-- figures that actually changed. *_held says why a figure isn't shown.

CREATE TABLE IF NOT EXISTS upf_shopify_sync (
  product_gid        TEXT PRIMARY KEY,
  product_title      TEXT,
  recipe_names       TEXT,
  -- linked | several_recipes | unlinked
  status             TEXT NOT NULL,
  upf_percent        NUMERIC(5,1),
  upf_published      NUMERIC(5,1),
  upf_held           TEXT,
  kcal_per_portion   INTEGER,
  kcal_published     INTEGER,
  kcal_held          TEXT,
  protein_per_portion NUMERIC(6,1),
  protein_published  NUMERIC(6,1),
  protein_held       TEXT,
  last_error         TEXT,
  checked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  written_at         TIMESTAMPTZ
);
