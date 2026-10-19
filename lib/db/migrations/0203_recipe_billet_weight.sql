-- Billet portion weight per recipe (Graeme, 19 Oct 2026). Objective A.
--
-- Cinnamon bun dough is not balled: each batch is portioned into one
-- "billet" and sheeted on the production morning. The dough is MADE at the
-- recipe's dough amount per batch (2,544 g for the buns — that is the spare),
-- but the team PORTIONS each billet lighter: "the number we actually use when
-- making it is 2467 … if we go 2544 we end up potentially short because of
-- wastage."
--
-- recipes.billet_weight_g   grams the dough station portions each billet to.
--                           NULL = the dough per batch (no allowance).
--                           Set from the recipe's Production route panel.
--
-- Data: recipe 27 (Cinnamon Buns) by id → 2,467 g.
-- Idempotent: re-running changes nothing.

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS billet_weight_g INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipes_billet_weight_g_check') THEN
    ALTER TABLE recipes ADD CONSTRAINT recipes_billet_weight_g_check
      CHECK (billet_weight_g IS NULL OR billet_weight_g > 0);
  END IF;
END $$;

UPDATE recipes SET billet_weight_g = 2467 WHERE id = 27 AND billet_weight_g IS NULL;
