-- The nutrition table on the website, from the planner (Graeme, 24 Oct 2026).
-- Objective B (the product we sell is honestly described).
--
-- "I've got out-of-date nutritional values saved in the product pages in the
-- nutritional meta field image slot... Let's change the nutritionals to a
-- table approach... per portion and per 100 g."
--
-- The website sync (api-server lib/upf-shopify-sync.ts, table from 0214) now
-- also writes each recipe's nutrition panel to the product metafield
-- custom.nutrition_panel (JSON), which the theme draws as a table in place of
-- the old image. Like the other figures, it's held back (and removed) while
-- any ingredient in the recipe is missing a nutrition value.
--
--   nutrition_panel      the JSON we'd publish now (NULL = held back)
--   nutrition_published  the JSON last written to Shopify (NULL = not there)
--   nutrition_held       why it's held back, in plain English

ALTER TABLE upf_shopify_sync ADD COLUMN IF NOT EXISTS nutrition_panel TEXT;
ALTER TABLE upf_shopify_sync ADD COLUMN IF NOT EXISTS nutrition_published TEXT;
ALTER TABLE upf_shopify_sync ADD COLUMN IF NOT EXISTS nutrition_held TEXT;
