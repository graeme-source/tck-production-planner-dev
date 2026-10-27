-- A recipe's pack size may be left blank (Graeme, 27 Oct 2026): "Pack size
-- here, for Balsamic Recipeals, it is 2, but for fried chicken, we'll just
-- leave it blank, and then it won't show... If we just don't have any...
-- pack size set, then we just show the per-100-g numbers." Objective B.
--
-- Blank (NULL) means: the website gets the nutrition table per 100 g only,
-- and no per-portion calories / protein. Everywhere else — planning, packs,
-- wrapping, costing, labels, QUID, Shopify — blank behaves exactly as 1
-- (recipePackSizeOrOne in SQL, effectivePackSize in TypeScript).
--
-- New recipes still default to 1.

ALTER TABLE recipes ALTER COLUMN pack_size DROP NOT NULL;

-- Fried chicken is sold by weight. It held 1, which is what blank behaves
-- as, so nothing in the kitchen changes. Data by category, not code.
UPDATE recipes SET pack_size = NULL WHERE category = 'Fried Chicken';
