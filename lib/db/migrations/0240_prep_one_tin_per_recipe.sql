-- "One tin per recipe" as a setting, not a list of ids in code (fix-queue
-- #320 + #325, Jane Miles; Graeme approved 22 Oct 2026). Objective C — the
-- Orders page's "still to prep" must count exactly the tins the prep
-- station lets you tick, or prep that's finished keeps holding an order up.
--
--   ingredients.prep_one_tin_per_recipe   true = Main Prep weighs this
--   sub_recipes.prep_one_tin_per_recipe   ingredient / sub-recipe as ONE tin
--       per recipe however many batches (e.g. Fresh Basil on an 11-batch
--       Margherita is one tin, not two). Read by the shared tin rule
--       prepUnitCount (api-server lib/stock-usage-rules.ts), which Main
--       Prep, the Orders deduction and the running-stock ledger all use.
--
-- Seed = today's behaviour exactly. Main Prep has hard-coded ingredient ids
-- 18, 19, 202 (Fresh Basil, Rosemary, Garlic Butter on live) and the
-- sub-recipe names "garlic butter" / "basil" / "basil puree"; those rows
-- are ticked here and the code reads the flag from now on. The runner
-- applies this file once, so unticking one later sticks.

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS prep_one_tin_per_recipe BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sub_recipes ADD COLUMN IF NOT EXISTS prep_one_tin_per_recipe BOOLEAN NOT NULL DEFAULT false;

UPDATE ingredients SET prep_one_tin_per_recipe = true WHERE id IN (18, 19, 202);

UPDATE sub_recipes SET prep_one_tin_per_recipe = true
 WHERE lower(trim(name)) IN ('garlic butter', 'basil', 'basil puree');
