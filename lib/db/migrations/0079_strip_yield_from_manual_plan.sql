-- Set the Buttermilk Fried Chicken Strip yield from the manual plan
-- (Graeme, 2026-09-04).
--
-- The strip's yield said 44 g of raw chicken makes 47.5 g of finished strip.
-- The four-year-old manual production plan — the numbers the product has
-- actually been made to — works to raw ≈ 97.6% of packed strip weight:
-- 0.39 kg of raw chicken per 400 g buttermilk bag. That makes the finished
-- strip 45.1 g per 44 g of chicken, and the difference was inflating every
-- run's bag count by about 5% (94 bags of buttermilk 400g from 75 kg where
-- the sheet says ~89).
--
--   yield          0.0475 -> 0.0451   (0.0440 chicken / 0.976)
--   yield_percent  55.50  -> 53.25    (0.0451 / 0.0847 total components)
--
-- Both fields move together because yields are DERIVED, never free-typed
-- (Graeme's rule, 2026-08-20, after the stale Bun Dough yield): every save
-- of a sub-recipe recomputes yield = component weight x yield_percent, so a
-- yield changed on its own would be silently un-done by the next edit.
--
-- The Korean sauce quantities are untouched — the sauce goes on top of the
-- strip, and how much of a Korean bag is sauce is being verified separately
-- by counting strips in real bags.
--
-- Guarded on the values it expects, so a hand-corrected live recipe is left
-- alone.

UPDATE sub_recipes
SET yield = 0.0451, yield_percent = 53.25
WHERE name = 'Buttermilk Fried Chicken Strip'
  AND yield = 0.0475;
