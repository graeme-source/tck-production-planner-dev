-- Recipe tagging — free-form text[] on recipes so the Recipes page can
-- show a tag filter + search bar alongside the existing category
-- dropdown. We deliberately avoid a normalised tags table: tags here
-- are personal classification (gluten-free, kids, summer, etc.) used
-- only on the Recipes page; renames are rare and a join table would
-- be over-engineering for the current scope.
--
-- Idempotent — safe to re-run.

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS recipes_tags_gin_idx
  ON recipes USING GIN (tags);
