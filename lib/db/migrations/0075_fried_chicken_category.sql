-- Make "Fried Chicken" a category you can pick, not one you have to invent
-- (Graeme, 2026-09-03).
--
-- Everything the fried chicken station does hangs off recipes being in this
-- category: the run suggestion, the prep sheet, the count sheet and the stock
-- submission all find their recipes by it. Until now the category existed only
-- in code, so the recipe form offered no such option and the whole station sat
-- empty until somebody typed the name exactly right — including the space and
-- both capitals.
--
-- Pack size is 1 because a bag IS the pack. The rest of the app defaults pack
-- size to 2 (a calzone two-pack), which would have every chicken bag counted
-- as half a pack everywhere it is totalled.
--
-- Costs are left at zero deliberately: they are per-recipe here and nobody has
-- a sensible average to seed. They stay editable in the category defaults.
INSERT INTO category_defaults (category, default_packaging_cost, default_labour_cost, default_pack_size)
VALUES ('Fried Chicken', 0, 0, 1)
ON CONFLICT (category) DO NOTHING;
