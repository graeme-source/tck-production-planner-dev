-- Automatic QUID (Graeme, 2026-10-10). Objectives A (a new recipe's label
-- data is generated, not re-keyed) and D (UK FIC Art. 22: an ingredient or
-- category named in the product name shows its percentage).
--
-- Every recipe save now ticks QUID on the lines its NAME names
-- (api-server lib/quid-matcher.ts). A person's tick or untick always wins
-- and is never overwritten; an automatic tick is taken off again when the
-- name or lines stop naming it. Percentages are never stored — the deck
-- works them out from live weights.
--
--  * recipe_ingredients.quid_source / recipe_sub_recipes.quid_source:
--    'auto' | 'manual' | NULL (nobody decided). Lines already ticked
--    (Chicken and Chorizo's chicken breast + diced chorizo on live) were
--    ticked by a person → 'manual'.
--  * recipe_quid_components: QUID on an ingredient INSIDE a sub-recipe line
--    (the chicken in a pie filling, the macaroni in Macaroni Cheese): its
--    share of the whole product goes after it inside the brackets.
--  * quid_terms: the words list the matcher reads names with — data, edited
--    on Labels → QUID words. Seeded below with the shipped list (kept equal
--    to DEFAULT_QUID_TERMS in quid-matcher.ts by a test).
--
-- Nothing here ticks anything: existing recipes change only when saved, or
-- when the backfill is run with --apply (scripts/quid-backfill.ts).

ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS quid_source text;
ALTER TABLE recipe_sub_recipes ADD COLUMN IF NOT EXISTS quid_source text;

UPDATE recipe_ingredients SET quid_source = 'manual' WHERE quid AND quid_source IS NULL;
UPDATE recipe_sub_recipes SET quid_source = 'manual' WHERE quid AND quid_source IS NULL;

CREATE TABLE IF NOT EXISTS recipe_quid_components (
  id serial PRIMARY KEY,
  recipe_id integer NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  sub_recipe_id integer NOT NULL REFERENCES sub_recipes(id) ON DELETE CASCADE,
  ingredient_id integer NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  quid boolean NOT NULL,
  source text NOT NULL CHECK (source IN ('auto', 'manual')),
  updated_at timestamp NOT NULL DEFAULT NOW(),
  updated_by_name text
);
CREATE UNIQUE INDEX IF NOT EXISTS recipe_quid_components_uq
  ON recipe_quid_components (recipe_id, sub_recipe_id, ingredient_id);

CREATE TABLE IF NOT EXISTS quid_terms (
  id serial PRIMARY KEY,
  phrase text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('auto', 'suggest', 'ignore', 'guard')),
  targets text[] NOT NULL DEFAULT '{}'::text[],
  categories text[] NOT NULL DEFAULT '{}'::text[],
  is_category boolean NOT NULL DEFAULT false,
  updated_at timestamp NOT NULL DEFAULT NOW(),
  updated_by_name text
);
-- One row per word in recipe names, and separately one per guard word in
-- line names ("dough" is both: ignored in names, a guard in lines).
CREATE UNIQUE INDEX IF NOT EXISTS quid_terms_phrase_kind_uq
  ON quid_terms (lower(phrase), (mode = 'guard'));

INSERT INTO quid_terms (phrase, mode, targets, categories, is_category) VALUES
-- seed:start
  ('chicken', 'auto', '{}'::text[], '{}'::text[], false),
  ('beef', 'auto', '{}'::text[], '{}'::text[], false),
  ('steak', 'auto', ARRAY['beef', 'steak']::text[], '{}'::text[], false),
  ('cheesesteak', 'auto', ARRAY['beef', 'steak']::text[], '{}'::text[], false),
  ('burger', 'auto', ARRAY['beef']::text[], '{}'::text[], false),
  ('cheeseburger', 'auto', ARRAY['beef', '@cheese']::text[], '{}'::text[], false),
  ('brisket', 'auto', ARRAY['brisket', 'beef']::text[], '{}'::text[], false),
  ('pork', 'auto', '{}'::text[], '{}'::text[], false),
  ('pulled pork', 'auto', ARRAY['pork']::text[], '{}'::text[], false),
  ('lamb', 'auto', '{}'::text[], '{}'::text[], false),
  ('duck', 'auto', '{}'::text[], '{}'::text[], false),
  ('turkey', 'auto', '{}'::text[], '{}'::text[], false),
  ('bacon', 'auto', '{}'::text[], '{}'::text[], false),
  ('ham', 'auto', '{}'::text[], '{}'::text[], false),
  ('sausage', 'auto', '{}'::text[], '{}'::text[], false),
  ('pigs in blankets', 'auto', ARRAY['pigs in blankets', 'sausage', 'bacon']::text[], '{}'::text[], false),
  ('pigs and blankets', 'auto', ARRAY['pigs in blankets', 'sausage', 'bacon']::text[], '{}'::text[], false),
  ('chorizo', 'auto', '{}'::text[], '{}'::text[], false),
  ('pepperoni', 'auto', '{}'::text[], '{}'::text[], false),
  ('salami', 'auto', '{}'::text[], '{}'::text[], false),
  ('pastrami', 'auto', '{}'::text[], '{}'::text[], false),
  ('nduja', 'auto', '{}'::text[], '{}'::text[], false),
  ('meatball', 'auto', '{}'::text[], '{}'::text[], false),
  ('prawn', 'auto', '{}'::text[], '{}'::text[], false),
  ('salmon', 'auto', '{}'::text[], '{}'::text[], false),
  ('tuna', 'auto', '{}'::text[], '{}'::text[], false),
  ('cheese', 'auto', ARRAY['cheese', 'mozzarella', 'fior di latte', 'cheddar', 'feta', 'monterey jack', 'parmesan', 'parmigiano', 'grana padano', 'pecorino', 'provolone', 'halloumi', 'ricotta', 'mascarpone', 'gouda', 'emmental', 'gruyere', 'brie', 'camembert', 'stilton', 'red leicester', 'burrata', 'paneer']::text[], ARRAY['cheese']::text[], true),
  ('fior di latte', 'auto', '{}'::text[], '{}'::text[], false),
  ('mozzarella', 'auto', '{}'::text[], '{}'::text[], false),
  ('cheddar', 'auto', '{}'::text[], '{}'::text[], false),
  ('feta', 'auto', '{}'::text[], '{}'::text[], false),
  ('halloumi', 'auto', '{}'::text[], '{}'::text[], false),
  ('goats cheese', 'auto', ARRAY['goat']::text[], '{}'::text[], false),
  ('garlic butter', 'auto', '{}'::text[], '{}'::text[], false),
  ('macaroni', 'auto', ARRAY['macaroni', 'pasta']::text[], ARRAY['pasta']::text[], false),
  ('mac', 'auto', ARRAY['macaroni', 'pasta']::text[], ARRAY['pasta']::text[], false),
  ('pasta', 'auto', ARRAY['pasta', 'macaroni']::text[], ARRAY['pasta']::text[], false),
  ('vegetables', 'auto', '{}'::text[], ARRAY['vegetable']::text[], true),
  ('veg', 'auto', '{}'::text[], ARRAY['vegetable']::text[], true),
  ('veggie', 'auto', '{}'::text[], ARRAY['vegetable']::text[], true),
  ('mushroom', 'auto', '{}'::text[], '{}'::text[], false),
  ('garlic', 'auto', '{}'::text[], '{}'::text[], false),
  ('onion', 'auto', '{}'::text[], '{}'::text[], false),
  ('red onion', 'auto', '{}'::text[], '{}'::text[], false),
  ('caramelised onion', 'auto', '{}'::text[], '{}'::text[], false),
  ('leek', 'auto', '{}'::text[], '{}'::text[], false),
  ('chilli', 'auto', ARRAY['chilli', 'chili']::text[], '{}'::text[], false),
  ('jalapeno', 'auto', '{}'::text[], '{}'::text[], false),
  ('red pepper', 'auto', '{}'::text[], '{}'::text[], false),
  ('spinach', 'auto', '{}'::text[], '{}'::text[], false),
  ('tomato', 'auto', '{}'::text[], '{}'::text[], false),
  ('sweetcorn', 'auto', '{}'::text[], '{}'::text[], false),
  ('olive', 'auto', '{}'::text[], '{}'::text[], false),
  ('potato', 'auto', '{}'::text[], '{}'::text[], false),
  ('tarragon', 'auto', '{}'::text[], '{}'::text[], false),
  ('sage', 'auto', '{}'::text[], '{}'::text[], false),
  ('mint', 'auto', '{}'::text[], '{}'::text[], false),
  ('minted', 'auto', ARRAY['mint']::text[], '{}'::text[], false),
  ('rosemary', 'auto', '{}'::text[], '{}'::text[], false),
  ('basil', 'auto', '{}'::text[], '{}'::text[], false),
  ('pesto', 'auto', '{}'::text[], '{}'::text[], false),
  ('truffle', 'auto', '{}'::text[], '{}'::text[], false),
  ('cranberry', 'auto', '{}'::text[], '{}'::text[], false),
  ('stuffing', 'auto', '{}'::text[], '{}'::text[], false),
  ('apple', 'auto', '{}'::text[], '{}'::text[], false),
  ('bbq', 'suggest', ARRAY['bbq', 'barbecue']::text[], '{}'::text[], false),
  ('barbecue', 'suggest', ARRAY['bbq', 'barbecue']::text[], '{}'::text[], false),
  ('honey', 'suggest', '{}'::text[], '{}'::text[], false),
  ('chipotle', 'suggest', '{}'::text[], '{}'::text[], false),
  ('hot', 'suggest', '{}'::text[], '{}'::text[], false),
  ('spicy', 'suggest', '{}'::text[], '{}'::text[], false),
  ('smoky', 'suggest', '{}'::text[], '{}'::text[], false),
  ('piri piri', 'suggest', ARRAY['piri piri', 'peri peri']::text[], '{}'::text[], false),
  ('peri peri', 'suggest', ARRAY['piri piri', 'peri peri']::text[], '{}'::text[], false),
  ('korma', 'suggest', '{}'::text[], '{}'::text[], false),
  ('tikka', 'suggest', '{}'::text[], '{}'::text[], false),
  ('balsamic', 'suggest', '{}'::text[], '{}'::text[], false),
  ('buffalo', 'suggest', '{}'::text[], '{}'::text[], false),
  ('jerk', 'suggest', '{}'::text[], '{}'::text[], false),
  ('teriyaki', 'suggest', '{}'::text[], '{}'::text[], false),
  ('hoisin', 'suggest', '{}'::text[], '{}'::text[], false),
  ('fajita', 'suggest', '{}'::text[], '{}'::text[], false),
  ('sriracha', 'suggest', '{}'::text[], '{}'::text[], false),
  ('buttermilk', 'suggest', '{}'::text[], '{}'::text[], false),
  ('the', 'ignore', '{}'::text[], '{}'::text[], false),
  ('and', 'ignore', '{}'::text[], '{}'::text[], false),
  ('with', 'ignore', '{}'::text[], '{}'::text[], false),
  ('in', 'ignore', '{}'::text[], '{}'::text[], false),
  ('on', 'ignore', '{}'::text[], '{}'::text[], false),
  ('of', 'ignore', '{}'::text[], '{}'::text[], false),
  ('double', 'ignore', '{}'::text[], '{}'::text[], false),
  ('triple', 'ignore', '{}'::text[], '{}'::text[], false),
  ('big', 'ignore', '{}'::text[], '{}'::text[], false),
  ('nanny', 'ignore', '{}'::text[], '{}'::text[], false),
  ('open', 'ignore', '{}'::text[], '{}'::text[], false),
  ('fire', 'ignore', '{}'::text[], '{}'::text[], false),
  ('roasted', 'ignore', '{}'::text[], '{}'::text[], false),
  ('roast', 'ignore', '{}'::text[], '{}'::text[], false),
  ('slow', 'ignore', '{}'::text[], '{}'::text[], false),
  ('cooked', 'ignore', '{}'::text[], '{}'::text[], false),
  ('pulled', 'ignore', '{}'::text[], '{}'::text[], false),
  ('special', 'ignore', '{}'::text[], '{}'::text[], false),
  ('calzone', 'ignore', '{}'::text[], '{}'::text[], false),
  ('pie', 'ignore', '{}'::text[], '{}'::text[], false),
  ('dinner', 'ignore', '{}'::text[], '{}'::text[], false),
  ('christmas', 'ignore', '{}'::text[], '{}'::text[], false),
  ('festive', 'ignore', '{}'::text[], '{}'::text[], false),
  ('fried', 'ignore', '{}'::text[], '{}'::text[], false),
  ('protein', 'ignore', '{}'::text[], '{}'::text[], false),
  ('draft', 'ignore', '{}'::text[], '{}'::text[], false),
  ('korean', 'ignore', '{}'::text[], '{}'::text[], false),
  ('philly', 'ignore', '{}'::text[], '{}'::text[], false),
  ('texican', 'ignore', '{}'::text[], '{}'::text[], false),
  ('texibean', 'ignore', '{}'::text[], '{}'::text[], false),
  ('cinco', 'ignore', '{}'::text[], '{}'::text[], false),
  ('carnage', 'ignore', '{}'::text[], '{}'::text[], false),
  ('con', 'ignore', '{}'::text[], '{}'::text[], false),
  ('carne', 'ignore', '{}'::text[], '{}'::text[], false),
  ('benji', 'ignore', '{}'::text[], '{}'::text[], false),
  ('godfather', 'ignore', '{}'::text[], '{}'::text[], false),
  ('donald', 'ignore', '{}'::text[], '{}'::text[], false),
  ('don', 'ignore', '{}'::text[], '{}'::text[], false),
  ('carnizone', 'ignore', '{}'::text[], '{}'::text[], false),
  ('properoni', 'ignore', '{}'::text[], '{}'::text[], false),
  ('margherita', 'ignore', '{}'::text[], '{}'::text[], false),
  ('tck', 'ignore', '{}'::text[], '{}'::text[], false),
  ('mayo', 'ignore', '{}'::text[], '{}'::text[], false),
  ('dough', 'ignore', '{}'::text[], '{}'::text[], false),
  ('ball', 'ignore', '{}'::text[], '{}'::text[], false),
  ('club', 'ignore', '{}'::text[], '{}'::text[], false),
  ('original', 'ignore', '{}'::text[], '{}'::text[], false),
  ('classic', 'ignore', '{}'::text[], '{}'::text[], false),
  ('loaded', 'ignore', '{}'::text[], '{}'::text[], false),
  ('kitchen', 'ignore', '{}'::text[], '{}'::text[], false),
  ('style', 'ignore', '{}'::text[], '{}'::text[], false),
  ('new', 'ignore', '{}'::text[], '{}'::text[], false),
  ('deluxe', 'ignore', '{}'::text[], '{}'::text[], false),
  ('ultimate', 'ignore', '{}'::text[], '{}'::text[], false),
  ('mini', 'ignore', '{}'::text[], '{}'::text[], false),
  ('test', 'ignore', '{}'::text[], '{}'::text[], false),
  ('wonky', 'ignore', '{}'::text[], '{}'::text[], false),
  ('box', 'ignore', '{}'::text[], '{}'::text[], false),
  ('pack', 'ignore', '{}'::text[], '{}'::text[], false),
  ('bun', 'ignore', '{}'::text[], '{}'::text[], false),
  ('dough', 'guard', '{}'::text[], '{}'::text[], false),
  ('base', 'guard', '{}'::text[], '{}'::text[], false),
  ('seasoning', 'guard', '{}'::text[], '{}'::text[], false),
  ('rub', 'guard', '{}'::text[], '{}'::text[], false),
  ('mix', 'guard', '{}'::text[], '{}'::text[], false),
  ('stock', 'guard', '{}'::text[], '{}'::text[], false),
  ('bouillon', 'guard', '{}'::text[], '{}'::text[], false),
  ('powder', 'guard', '{}'::text[], '{}'::text[], false),
  ('granules', 'guard', '{}'::text[], '{}'::text[], false),
  ('flavour', 'guard', '{}'::text[], '{}'::text[], false),
  ('flavouring', 'guard', '{}'::text[], '{}'::text[], false),
  ('extract', 'guard', '{}'::text[], '{}'::text[], false),
  ('salt', 'guard', '{}'::text[], '{}'::text[], false),
  ('breading', 'guard', '{}'::text[], '{}'::text[], false),
  ('marinade', 'guard', '{}'::text[], '{}'::text[], false)
-- seed:end
ON CONFLICT DO NOTHING;

UPDATE quid_terms SET updated_by_name = 'Shipped list (migration 0165)' WHERE updated_by_name IS NULL;
