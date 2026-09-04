-- Final fried chicken calibration, from measurement (Graeme, 2026-09-04).
--
-- Three measured numbers, now all in agreement:
--
--   * 43.7 g raw chicken per strip   (74.771 kg made ~1,710 strips, the
--                                     four-year production ratio)
--   * 43.5 g cooked strip            (printed on the old strip-count-era
--                                     packaging as the average)
--   * 7.8 strips per Korean 500 g    (counted across five real bags)
--
-- So frying is almost weight-neutral: water loss ~ breading + marinade
-- pickup, raw:packed = 1.005. The yield set in 0079 (0.976, from reading
-- the manual sheet) was close but slightly generous; this replaces it with
-- the packaging figure. (The sheet's "51+29 from 1,710 strips" that briefly
-- suggested a 29 g strip turned out to be the old calculator's 70% planning
-- column, not physics.)
--
--   strip yield          0.0451 -> 0.0438   (0.0440 chicken x 43.5/43.7)
--   strip yield_percent  53.25  -> 51.71    (0.0438 / 0.0847 components)
--
-- The Korean strip quantities are strips-per-bag x yield, so they move with
-- it (7.8 strips for the 500 g; the 1.2 kg keeps its strip count):
--
--   Korean 500g:  strip 0.3518 -> 0.3416,  sauce 0.1482 -> 0.1584
--   Korean 1.2kg: strip 0.8443 -> 0.8199,  sauce 0.3557 -> 0.3801
--
-- Both bags still sum exactly to label weight. Sauce comes out at ~32% of a
-- Korean bag (~380 g on the 1.2 kg, where Graeme's estimate was ~350 g).
-- Raw cost per Korean 500 g bag stays 7.8 x 43.7 g = 0.343 kg by
-- construction.
--
-- Guards match the values Graeme entered on live on 2026-09-04, so this
-- migration corrects live at deploy with no re-typing; a hand-edited value
-- is left alone.

UPDATE sub_recipes
SET yield = 0.0438, yield_percent = 51.71
WHERE name = 'Buttermilk Fried Chicken Strip'
  AND yield = 0.0451;

UPDATE recipe_sub_recipes
SET quantity = 0.3416
WHERE recipe_id = (SELECT id FROM recipes WHERE name = 'Korean Fried Chicken 500g')
  AND sub_recipe_id = (SELECT id FROM sub_recipes WHERE name = 'Buttermilk Fried Chicken Strip')
  AND quantity = 0.3518;

UPDATE recipe_sub_recipes
SET quantity = 0.1584
WHERE recipe_id = (SELECT id FROM recipes WHERE name = 'Korean Fried Chicken 500g')
  AND sub_recipe_id = (SELECT id FROM sub_recipes WHERE name = 'Yangnyeom Korean Dipping Sauce')
  AND quantity = 0.1482;

UPDATE recipe_sub_recipes
SET quantity = 0.8199
WHERE recipe_id = (SELECT id FROM recipes WHERE name = 'Korean Fried Chicken 1.2kg')
  AND sub_recipe_id = (SELECT id FROM sub_recipes WHERE name = 'Buttermilk Fried Chicken Strip')
  AND quantity = 0.8443;

UPDATE recipe_sub_recipes
SET quantity = 0.3801
WHERE recipe_id = (SELECT id FROM recipes WHERE name = 'Korean Fried Chicken 1.2kg')
  AND sub_recipe_id = (SELECT id FROM sub_recipes WHERE name = 'Yangnyeom Korean Dipping Sauce')
  AND quantity = 0.3557;
