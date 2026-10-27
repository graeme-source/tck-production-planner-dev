-- Cinnamon buns back label (Graeme, 27 Oct 2026). Objective D.
--
-- 1. Adds the "Cinnamon buns" label template if there isn't one of that
--    name. Its settings are the "cinnamon-buns" preset
--    (lib/product-labels template.ts cinnamonBunsTemplate()) after
--    enforceLegalMinimums, as Label design's "Add a template" stores it. It
--    is the default for the "Desserts" recipe category (where Cinnamon Buns
--    sit), so a dessert with no template picked gets it.
-- 2. Points the cinnamon bun recipe(s) that have no template picked at it,
--    and sets their label's chilled use-by to 5 days where none is set. The
--    recipe's shelf_life_days is 180 (the frozen-at-the-factory life, used by
--    planning), which would otherwise print a 180-day chilled use-by; Graeme's
--    current label prints 5 days (27 Oct -> 01/11/26).
--
-- No cinnamon bun label has been published, so no live label changes.
-- Safe to run twice.

INSERT INTO product_label_templates (name, settings, updated_at, updated_by_name)
SELECT 'Cinnamon buns', '{"page":{"widthMm":140,"heightMm":94,"dpi":203,"marginMm":4.5,"columnSplitPct":41,"columnGapMm":3,"titleBandMm":7,"stepsBandMm":11,"bandGapMm":3,"fieldGapMm":3,"dividerOn":true,"dividerMm":0.25,"stepCircleAuto":true,"stepCircleMm":5.5,"barcodeHeightMm":15,"barcodeSizePct":151,"smallPack":false},"fields":{"title":{"width":"normal","narrowest":"condensed","weight":700,"minPt":12,"maxPt":22,"letterSpacingEm":0,"lineHeight":1,"bold":true,"caps":true,"align":"center"},"subtitle":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":9,"letterSpacingEm":0,"lineHeight":1.1,"bold":false,"caps":false,"align":"center"},"steps":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":10.5,"letterSpacingEm":0,"lineHeight":1.1,"bold":false,"caps":false,"align":"left"},"headings":{"width":"normal","narrowest":"normal","weight":700,"minPt":12.5,"maxPt":12.5,"letterSpacingEm":0,"lineHeight":1.1,"bold":true,"caps":true,"align":"left"},"storage":{"width":"semi-condensed","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":10.5,"letterSpacingEm":0,"lineHeight":1.12,"bold":false,"caps":false,"align":"left"},"dates":{"width":"semi-condensed","narrowest":"semi-condensed","weight":700,"minPt":6.75,"maxPt":10,"letterSpacingEm":0,"lineHeight":1.12,"bold":true,"caps":false,"align":"left"},"ingredients":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":10.5,"letterSpacingEm":0,"lineHeight":1.12,"bold":false,"caps":false,"align":"left"},"allergenInfo":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":9,"letterSpacingEm":0,"lineHeight":1.12,"bold":false,"caps":false,"align":"left"},"address":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":8,"letterSpacingEm":0,"lineHeight":1.12,"bold":false,"caps":false,"align":"left"}},"text":{"title":"{name} - {packSize} PACK","subtitle":"Recipe by Chris","storageHeading":"STORAGE INSTRUCTIONS:","storage":"Keep me chilled below 5°C. Do not freeze.","chilledLabel":"USE BY:","frozenLabel":"IF FROZEN USE BY:","batchLabel":"BATCH NUMBER:","ingredientsHeading":"THE INGREDIENTS:","allergenNote":"Allergens are shown in **Bold**.","warning":"**WARNING:** Whilst every effort has been made to remove all bones, some may remain.","address":"Handcrafted at The Calzone Kitchen, Unit 1b, Lower Rectory Farm, Mill Lane, Great Brickhill, Buckinghamshire, MK17 9FX","steps":["Remove the film cover and place the tray in the microwave.","Heat in a microwave on full power for 2 minutes (6 buns). Adjust the cooking time for fewer buns.","Leave to cool for 1 minute and serve."]},"cooking":{"ovenTempC":null,"fanTempC":null,"ovenMinMinutes":null,"ovenMaxMinutes":null,"airFryerTempC":null,"airFryerMinMinutes":null,"airFryerMaxMinutes":null},"cookingTiers":{"on":false,"tiers":[{"key":"light","name":"Light","maxWeightG":260,"maxMeatG":20,"cooking":{"ovenTempC":null,"fanTempC":null,"ovenMinMinutes":14,"ovenMaxMinutes":16,"airFryerTempC":165,"airFryerMinMinutes":12,"airFryerMaxMinutes":15}},{"key":"medium","name":"Medium","maxWeightG":330,"maxMeatG":45,"cooking":{"ovenTempC":null,"fanTempC":null,"ovenMinMinutes":16,"ovenMaxMinutes":19,"airFryerTempC":null,"airFryerMinMinutes":14,"airFryerMaxMinutes":17}},{"key":"heavy","name":"Heavy","maxWeightG":null,"maxMeatG":null,"cooking":{"ovenTempC":null,"fanTempC":null,"ovenMinMinutes":18,"ovenMaxMinutes":22,"airFryerTempC":null,"airFryerMinMinutes":16,"airFryerMaxMinutes":19}}],"maxOvenMinutes":22,"maxAirFryerMinutes":19,"categories":{"meat":["raw_meat","cooked_meat"],"veg":["vegetable"],"cheese":["cheese","dairy"],"dough":["dough"]}},"chilledDefault":{"amount":5,"unit":"days"},"frozenDefault":null,"batchBasis":"production-day","mayContainBoldList":true,"boneRiskWords":[],"storageBanner":{"on":false,"text":"KEEP FROZEN","snowflake":true,"heightMm":6.5},"chilledUseByOn":true,"netQuantity":{"on":false,"sizePt":16},"warningPlacement":"allergens","defaultForCategories":["Desserts"]}'::jsonb, NOW(), 'Cinnamon buns template (release)'
 WHERE NOT EXISTS (SELECT 1 FROM product_label_templates WHERE lower(trim(name)) = 'cinnamon buns');

WITH tpl AS (
  SELECT id FROM product_label_templates WHERE lower(trim(name)) = 'cinnamon buns' ORDER BY id LIMIT 1
)
INSERT INTO product_label_settings (recipe_id, template_id, chilled_amount, chilled_unit, updated_at, updated_by_name)
SELECT r.id, tpl.id, 5, 'days', NOW(), 'Cinnamon buns template (release)'
  FROM recipes r CROSS JOIN tpl
 WHERE r.name ILIKE '%cinnamon bun%'
ON CONFLICT (recipe_id) DO UPDATE
   SET template_id = EXCLUDED.template_id,
       chilled_amount = COALESCE(product_label_settings.chilled_amount, EXCLUDED.chilled_amount),
       chilled_unit = CASE WHEN product_label_settings.chilled_amount IS NULL THEN EXCLUDED.chilled_unit ELSE product_label_settings.chilled_unit END,
       updated_at = EXCLUDED.updated_at,
       updated_by_name = EXCLUDED.updated_by_name
 WHERE product_label_settings.template_id IS NULL;
