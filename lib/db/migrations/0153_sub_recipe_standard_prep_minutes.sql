-- Standard prep time per sub-recipe (Graeme, 2026-10-09). Objectives C/E:
-- when a sub-recipe is wasted, "How long to make it again?" is pre-filled
-- from this — minutes for ONE batch (the sub-recipe's yield), scaled by the
-- amount wasted ÷ the batch yield. Used for nothing else. NULL = not known
-- (the waste form then asks). Edited, autosaved, on the Sub-Recipes page.
ALTER TABLE sub_recipes ADD COLUMN IF NOT EXISTS standard_prep_minutes INTEGER
  CHECK (standard_prep_minutes IS NULL OR (standard_prep_minutes > 0 AND standard_prep_minutes <= 1440));
