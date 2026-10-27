-- Macaroni cheese back label (Graeme, 27 Oct 2026). Objective D.
--
-- 1. Adds the "Macaroni cheese" label template if there isn't one of that
--    name. Its settings are the "macaroni-cheese" preset
--    (lib/product-labels template.ts macaroniCheeseTemplate()) after
--    enforceLegalMinimums, exactly as Label design's "Add a template" stores
--    it. It is the default for the "Macaroni Cheese" recipe category
--    (defaultForCategories), so a mac cheese with no template picked gets it.
-- 2. Points Big Nanny's Macaroni Cheese (15) and Pigs & Blankets (16) at it,
--    with their own oven values written as Manual cooking times (as the
--    recipe's label settings page saves them): 15 = 180 fan / 200, 16 = 170
--    fan / 190, both 20-25 minutes. By id AND name, so a re-used id is never
--    touched; a recipe that already picked a different template keeps it.
-- 3. Any other Macaroni Cheese recipe with no template picked is pointed at
--    it too (e.g. the Honey Chipotle draft, which keeps the template's own
--    cooking values).
--
-- No macaroni cheese label has been published (product_label_versions has
-- none for these recipes), so no live label changes. Safe to run twice.

INSERT INTO product_label_templates (name, settings, updated_at, updated_by_name)
SELECT 'Macaroni cheese', '{"page":{"widthMm":140,"heightMm":94,"dpi":203,"marginMm":4.5,"columnSplitPct":41,"columnGapMm":3,"titleBandMm":7,"stepsBandMm":8,"bandGapMm":3,"fieldGapMm":3,"dividerOn":true,"dividerMm":0.25,"stepCircleAuto":true,"stepCircleMm":5.5,"barcodeHeightMm":15,"barcodeSizePct":151,"smallPack":false},"fields":{"title":{"width":"normal","narrowest":"condensed","weight":700,"minPt":12,"maxPt":22,"letterSpacingEm":0,"lineHeight":1,"bold":true,"caps":true,"align":"center"},"steps":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":10.5,"letterSpacingEm":0,"lineHeight":1.1,"bold":false,"caps":false,"align":"left"},"headings":{"width":"normal","narrowest":"normal","weight":700,"minPt":12.5,"maxPt":12.5,"letterSpacingEm":0,"lineHeight":1.1,"bold":true,"caps":true,"align":"left"},"storage":{"width":"semi-condensed","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":10.5,"letterSpacingEm":0,"lineHeight":1.12,"bold":false,"caps":false,"align":"left"},"dates":{"width":"semi-condensed","narrowest":"semi-condensed","weight":700,"minPt":6.75,"maxPt":10,"letterSpacingEm":0,"lineHeight":1.12,"bold":true,"caps":false,"align":"left"},"ingredients":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":10.5,"letterSpacingEm":0,"lineHeight":1.12,"bold":false,"caps":false,"align":"left"},"allergenInfo":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":9,"letterSpacingEm":0,"lineHeight":1.12,"bold":false,"caps":false,"align":"left"},"address":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":8,"letterSpacingEm":0,"lineHeight":1.12,"bold":false,"caps":false,"align":"left"}},"text":{"title":"{name}","storageHeading":"STORAGE INSTRUCTIONS:","storage":"If chilled, keep me below 5°C. If frozen, keep below -18°C. If you decide to freeze me, please do so immediately, fully defrost in a fridge before cooking and eat within 24 hours of defrosting.","chilledLabel":"IF CHILLED USE BY:","frozenLabel":"IF FROZEN USE BY:","batchLabel":"BATCH NUMBER:","ingredientsHeading":"THE INGREDIENTS:","allergenNote":"Allergens are shown in **Bold**.","warning":"**WARNING:** Whilst every effort has been made to remove all bones, some may remain.","address":"Handcrafted at The Calzone Kitchen, Unit 1b, Lower Rectory Farm, Mill Lane, Great Brickhill, Buckinghamshire, MK17 9FX","steps":["Pre-heat the oven to {ovenTemps} and remove the outer film.","Cook in the centre of the oven for {ovenMin}–{ovenMax} minutes until piping hot."]},"cooking":{"ovenTempC":200,"fanTempC":180,"ovenMinMinutes":20,"ovenMaxMinutes":25,"airFryerTempC":null,"airFryerMinMinutes":null,"airFryerMaxMinutes":null},"cookingTiers":{"on":false,"tiers":[{"key":"light","name":"Light","maxWeightG":260,"maxMeatG":20,"cooking":{"ovenTempC":null,"fanTempC":null,"ovenMinMinutes":14,"ovenMaxMinutes":16,"airFryerTempC":165,"airFryerMinMinutes":12,"airFryerMaxMinutes":15}},{"key":"medium","name":"Medium","maxWeightG":330,"maxMeatG":45,"cooking":{"ovenTempC":null,"fanTempC":null,"ovenMinMinutes":16,"ovenMaxMinutes":19,"airFryerTempC":null,"airFryerMinMinutes":14,"airFryerMaxMinutes":17}},{"key":"heavy","name":"Heavy","maxWeightG":null,"maxMeatG":null,"cooking":{"ovenTempC":null,"fanTempC":null,"ovenMinMinutes":18,"ovenMaxMinutes":22,"airFryerTempC":null,"airFryerMinMinutes":16,"airFryerMaxMinutes":19}}],"maxOvenMinutes":30,"maxAirFryerMinutes":null,"categories":{"meat":["raw_meat","cooked_meat"],"veg":["vegetable"],"cheese":["cheese","dairy"],"dough":["dough"]}},"chilledDefault":{"amount":13,"unit":"days"},"frozenDefault":{"amount":3,"unit":"months"},"batchBasis":"production-day","mayContainBoldList":true,"boneRiskWords":[],"storageBanner":{"on":false,"text":"KEEP FROZEN","snowflake":true,"heightMm":6.5},"chilledUseByOn":true,"netQuantity":{"on":false,"sizePt":16},"warningPlacement":"allergens","defaultForCategories":["Macaroni Cheese"]}'::jsonb, NOW(), 'Macaroni cheese template (release)'
 WHERE NOT EXISTS (SELECT 1 FROM product_label_templates WHERE lower(trim(name)) = 'macaroni cheese');

WITH tpl AS (
  SELECT id FROM product_label_templates WHERE lower(trim(name)) = 'macaroni cheese' ORDER BY id LIMIT 1
), wanted (recipe_id, recipe_name, oven_c, fan_c) AS (
  VALUES (15, 'big nanny''s macaroni cheese', 200, 180),
         (16, 'pigs & blankets - big nanny''s macaroni cheese', 190, 170)
)
INSERT INTO product_label_settings
  (recipe_id, template_id, oven_temp_c, fan_temp_c, oven_min_minutes, oven_max_minutes, cooking_mode, updated_at, updated_by_name)
SELECT r.id, tpl.id, w.oven_c, w.fan_c, 20, 25, 'manual', NOW(), 'Macaroni cheese template (release)'
  FROM wanted w
  JOIN recipes r ON r.id = w.recipe_id AND lower(trim(r.name)) = w.recipe_name
 CROSS JOIN tpl
ON CONFLICT (recipe_id) DO UPDATE
   SET template_id = EXCLUDED.template_id,
       oven_temp_c = EXCLUDED.oven_temp_c,
       fan_temp_c = EXCLUDED.fan_temp_c,
       oven_min_minutes = EXCLUDED.oven_min_minutes,
       oven_max_minutes = EXCLUDED.oven_max_minutes,
       cooking_mode = EXCLUDED.cooking_mode,
       updated_at = EXCLUDED.updated_at,
       updated_by_name = EXCLUDED.updated_by_name
 WHERE product_label_settings.template_id IS NULL
    OR product_label_settings.template_id = EXCLUDED.template_id;

WITH tpl AS (
  SELECT id FROM product_label_templates WHERE lower(trim(name)) = 'macaroni cheese' ORDER BY id LIMIT 1
)
INSERT INTO product_label_settings (recipe_id, template_id, updated_at, updated_by_name)
SELECT r.id, tpl.id, NOW(), 'Macaroni cheese template (release)'
  FROM recipes r CROSS JOIN tpl
 WHERE lower(trim(r.category)) = 'macaroni cheese'
ON CONFLICT (recipe_id) DO UPDATE
   SET template_id = EXCLUDED.template_id,
       updated_at = EXCLUDED.updated_at,
       updated_by_name = EXCLUDED.updated_by_name
 WHERE product_label_settings.template_id IS NULL;
