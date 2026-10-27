-- One source of truth for shelf life, and the cinnamon buns' two labels
-- (Graeme, 27 Oct 2026). Objective D. Logic: lib/product-labels
-- shelf-life.ts and label-roles.ts.
--
-- "I want a single source of truth for shelf life in any given product. I
-- don't want to be able to change it in the recipe and have it not come
-- through on the label, or vice versa."
--
-- 1. The label-only chilled override (product_label_settings.chilled_amount
--    / chilled_unit) is gone: the recipe's shelf_life_days is the chilled
--    use-by. Only recipe 27 "Cinnamon Buns" had one (5 days, beside its
--    180-day freezer shelf life — checked in tck_live on 27 Oct). That 5 days
--    becomes what it really was: the Cinnamon buns template's DESPATCH
--    use-by — 5 days from despatch (the print day), whatever the recipe's
--    shelf life. Taken from the override of a recipe on that template, else
--    5 days, and only if the template has no use-by rule yet.
-- 2. Every override is then cleared (the app no longer reads the columns;
--    they stay in the table). No published label had an override, and no
--    cinnamon bun label has been published, so no live label changes.
-- 3. Adds the "Internal freezer label (102 × 25 mm)" template (the
--    "internal-freezer" preset after enforceLegalMinimums, as "Add a
--    template" stores it): name, USE BY = print day + the recipe's shelf
--    life, BATCH, no barcode. Not a category default.
-- 4. Recipe 27 "Cinnamon Buns" gets it as its WRAPPING label (migration
--    0310), so the wrapping station prints the small 180-day freezer label
--    and the big despatch label prints from the dessert report. Only while
--    the recipe name still matches, and only if no wrapping label is set.
--
-- Safe to run twice.

WITH bun_template AS (
  SELECT id FROM product_label_templates WHERE lower(trim(name)) = 'cinnamon buns' ORDER BY id LIMIT 1
), override AS (
  SELECT s.chilled_amount AS amount, COALESCE(NULLIF(s.chilled_unit, ''), 'days') AS unit
    FROM product_label_settings s JOIN bun_template t ON t.id = s.template_id
   WHERE s.chilled_amount IS NOT NULL AND s.chilled_amount > 0
   ORDER BY s.recipe_id LIMIT 1
)
UPDATE product_label_templates
   SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{useBy}',
         jsonb_build_object('from', 'despatch', 'period', jsonb_build_object(
           'amount', COALESCE((SELECT amount FROM override), 5),
           'unit', COALESCE((SELECT unit FROM override), 'days')))),
       version = version + 1,
       updated_at = NOW(),
       updated_by_name = 'Use-by from despatch (release)'
 WHERE id = (SELECT id FROM bun_template)
   AND NOT (COALESCE(settings, '{}'::jsonb) ? 'useBy');

UPDATE product_label_settings
   SET chilled_amount = NULL, chilled_unit = NULL,
       updated_at = NOW(), updated_by_name = 'Shelf life single source (release)'
 WHERE chilled_amount IS NOT NULL OR chilled_unit IS NOT NULL;

INSERT INTO product_label_templates (name, settings, updated_at, updated_by_name)
SELECT 'Internal freezer label (102 × 25 mm)', '{"format":"small-102x25","page":{"widthMm":102,"heightMm":25,"dpi":203,"marginMm":4.5,"columnSplitPct":41,"columnGapMm":3,"titleBandMm":7,"stepsBandMm":8,"bandGapMm":3,"fieldGapMm":3,"dividerOn":true,"dividerMm":0.25,"stepCircleAuto":true,"stepCircleMm":5.5,"barcodeHeightMm":15,"barcodeSizePct":151,"smallPack":false},"fields":{"title":{"width":"normal","narrowest":"condensed","weight":700,"minPt":12,"maxPt":22,"letterSpacingEm":0,"lineHeight":1,"bold":true,"caps":true,"align":"center"},"subtitle":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":9,"letterSpacingEm":0,"lineHeight":1.1,"bold":false,"caps":false,"align":"center"},"steps":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":10.5,"letterSpacingEm":0,"lineHeight":1.1,"bold":false,"caps":false,"align":"left"},"headings":{"width":"normal","narrowest":"normal","weight":700,"minPt":12.5,"maxPt":12.5,"letterSpacingEm":0,"lineHeight":1.1,"bold":true,"caps":true,"align":"left"},"storage":{"width":"semi-condensed","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":10.5,"letterSpacingEm":0,"lineHeight":1.12,"bold":false,"caps":false,"align":"left"},"dates":{"width":"semi-condensed","narrowest":"semi-condensed","weight":700,"minPt":6.75,"maxPt":10,"letterSpacingEm":0,"lineHeight":1.12,"bold":true,"caps":false,"align":"left"},"ingredients":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":10.5,"letterSpacingEm":0,"lineHeight":1.12,"bold":false,"caps":false,"align":"left"},"allergenInfo":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":9,"letterSpacingEm":0,"lineHeight":1.12,"bold":false,"caps":false,"align":"left"},"address":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":8,"letterSpacingEm":0,"lineHeight":1.12,"bold":false,"caps":false,"align":"left"}},"text":{"title":"{name}","subtitle":"","storageHeading":"STORAGE INSTRUCTIONS:","storage":"Keep chilled below 5°C, or freeze immediately and keep below -18°C. Defrost fully in the fridge before cooking and eat within 24 hours of defrosting.","chilledLabel":"USE BY:","frozenLabel":"IF FROZEN USE BY:","batchLabel":"BATCH:","ingredientsHeading":"THE INGREDIENTS:","allergenNote":"Allergens are shown in **Bold**.","warning":"**WARNING:** Whilst every effort has been made to remove all bones, some may remain.","address":"Handcrafted at The Calzone Kitchen, Unit 1b, Lower Rectory Farm, Mill Lane, Great Brickhill, Buckinghamshire, MK17 9FX","steps":[]},"cooking":{"ovenTempC":null,"fanTempC":null,"ovenMinMinutes":null,"ovenMaxMinutes":null,"airFryerTempC":null,"airFryerMinMinutes":null,"airFryerMaxMinutes":null},"cookingTiers":{"on":false,"tiers":[{"key":"light","name":"Light","maxWeightG":260,"maxMeatG":20,"cooking":{"ovenTempC":null,"fanTempC":null,"ovenMinMinutes":14,"ovenMaxMinutes":16,"airFryerTempC":165,"airFryerMinMinutes":12,"airFryerMaxMinutes":15}},{"key":"medium","name":"Medium","maxWeightG":330,"maxMeatG":45,"cooking":{"ovenTempC":null,"fanTempC":null,"ovenMinMinutes":16,"ovenMaxMinutes":19,"airFryerTempC":null,"airFryerMinMinutes":14,"airFryerMaxMinutes":17}},{"key":"heavy","name":"Heavy","maxWeightG":null,"maxMeatG":null,"cooking":{"ovenTempC":null,"fanTempC":null,"ovenMinMinutes":18,"ovenMaxMinutes":22,"airFryerTempC":null,"airFryerMinMinutes":16,"airFryerMaxMinutes":19}}],"maxOvenMinutes":22,"maxAirFryerMinutes":19,"categories":{"meat":["raw_meat","cooked_meat"],"veg":["vegetable"],"cheese":["cheese","dairy"],"dough":["dough"]}},"chilledDefault":null,"frozenDefault":null,"batchBasis":"production-day","mayContainBoldList":true,"boneRiskWords":[],"storageBanner":{"on":false,"text":"KEEP FROZEN","snowflake":true,"heightMm":6.5},"chilledUseByOn":true,"bestBefore":{"on":false,"label":"BEST BEFORE:","period":{"amount":3,"unit":"days"}},"useBy":{"from":"recipe-shelf-life"},"barcodeOn":false,"netQuantity":{"on":false,"sizePt":16},"warningPlacement":"allergens","defaultForCategories":[]}'::jsonb, NOW(), 'Internal freezer label (release)'
 WHERE NOT EXISTS (SELECT 1 FROM product_label_templates WHERE lower(trim(name)) = lower('Internal freezer label (102 × 25 mm)'));

WITH tpl AS (
  SELECT id FROM product_label_templates WHERE lower(trim(name)) = lower('Internal freezer label (102 × 25 mm)') ORDER BY id LIMIT 1
)
INSERT INTO product_label_settings (recipe_id, wrapping_template_id, updated_at, updated_by_name)
SELECT r.id, tpl.id, NOW(), 'Internal freezer label (release)'
  FROM recipes r CROSS JOIN tpl
 WHERE r.id = 27 AND r.name ILIKE 'Cinnamon Bun%'
ON CONFLICT (recipe_id) DO UPDATE
   SET wrapping_template_id = EXCLUDED.wrapping_template_id,
       updated_at = EXCLUDED.updated_at,
       updated_by_name = EXCLUDED.updated_by_name
 WHERE product_label_settings.wrapping_template_id IS NULL;
