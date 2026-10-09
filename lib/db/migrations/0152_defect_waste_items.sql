-- Defects & waste (Graeme, 2026-10-09). Objectives C (waste recorded when it
-- happens — what, how much, why, and what it cost) and E (it counts against
-- the day's efficiency, so it can be reduced).
--
-- This morning a batch of house-made nacho cheese was left out at ambient
-- overnight and about 2.3 kg went in the bin. "Report defect" becomes
-- "Report defect / waste": the same record can now name ANY item — an
-- ingredient, a sub-recipe or a finished pack (a 2-pack, an 8-pack bag) —
-- with an amount, and carries what it cost.
--
-- Old rows keep their meaning: item_kind stays NULL, they have no cost, and
-- they still count in the Defects KPI by their packs exactly as before.
--
-- 1) What the record is about. Exactly one of ingredient_id / sub_recipe_id
--    / recipe_id is set for a new-style row (recipe_id already exists, for
--    a finished pack). item_name is a snapshot so a renamed or archived item
--    still reads right in the history.
--      item_kind       'ingredient' | 'sub_recipe' | 'product'; NULL = old row
--      pack_kind       products only: 'pack' (the recipe's own pack, e.g. a
--                      2-pack) or 'eight_pack_bag'
--      quantity        the amount as entered (packs, bags, or a weight/count)
--      quantity_unit   'pack' | 'bag' | a unit @workspace/units knows (g, kg,
--                      ml, l) | the ingredient's own count unit (each, …)
-- 2) What it cost, worked out and SNAPSHOT when saved, so a later price or
--    pay change never rewrites history (api-server lib/waste-cost.ts):
--      remake_minutes   how long to make it again (0 = won't be remade)
--      hourly_rate      the team's real average production labour cost per
--                       hour (incl. holiday, NI, pension) at the time
--      ingredient_cost  ingredients (and packaging, for packs) £
--      time_cost        remake_minutes × hourly_rate ÷ 60, £
--      lost_value       what comes off that day's efficiency credited value:
--                       ingredient cost for ingredients and sub-recipes, the
--                       value a pack was credited when made for packs.
--                       Remake time is NOT in it (those wages are already in
--                       the day's labour — deducting them would double count).
-- 3) packs may now be 0: a kilo of sauce is waste, not a defective pack, so
--    it adds nothing to the Defects KPI's pack count (still ≥ 1 for packs).
ALTER TABLE defects ADD COLUMN IF NOT EXISTS item_kind TEXT
  CHECK (item_kind IS NULL OR item_kind IN ('ingredient', 'sub_recipe', 'product'));
ALTER TABLE defects ADD COLUMN IF NOT EXISTS ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL;
ALTER TABLE defects ADD COLUMN IF NOT EXISTS sub_recipe_id INTEGER REFERENCES sub_recipes(id) ON DELETE SET NULL;
ALTER TABLE defects ADD COLUMN IF NOT EXISTS pack_kind TEXT
  CHECK (pack_kind IS NULL OR pack_kind IN ('pack', 'eight_pack_bag'));
ALTER TABLE defects ADD COLUMN IF NOT EXISTS item_name TEXT;
ALTER TABLE defects ADD COLUMN IF NOT EXISTS quantity NUMERIC(14, 4) CHECK (quantity IS NULL OR quantity > 0);
ALTER TABLE defects ADD COLUMN IF NOT EXISTS quantity_unit TEXT;
ALTER TABLE defects ADD COLUMN IF NOT EXISTS remake_minutes INTEGER CHECK (remake_minutes IS NULL OR remake_minutes >= 0);
ALTER TABLE defects ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10, 4);
ALTER TABLE defects ADD COLUMN IF NOT EXISTS ingredient_cost NUMERIC(12, 2);
ALTER TABLE defects ADD COLUMN IF NOT EXISTS time_cost NUMERIC(12, 2);
ALTER TABLE defects ADD COLUMN IF NOT EXISTS lost_value NUMERIC(12, 2);

ALTER TABLE defects DROP CONSTRAINT IF EXISTS defects_packs_check;
ALTER TABLE defects ADD CONSTRAINT defects_packs_check CHECK (packs >= 0);

-- 4) A reason for waste like this morning's — only if nothing equivalent is
--    there already (types are admin-editable data, so match loosely).
INSERT INTO defect_types (name, sort_order)
SELECT 'Left out of the fridge / temperature', COALESCE(MAX(sort_order), 0) + 10 FROM defect_types
WHERE NOT EXISTS (
  SELECT 1 FROM defect_types WHERE name ILIKE '%fridge%' OR name ILIKE '%temperature%' OR name ILIKE '%left out%'
)
ON CONFLICT DO NOTHING;
