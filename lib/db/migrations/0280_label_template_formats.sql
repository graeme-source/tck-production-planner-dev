-- Label templates with a fixed size, and category defaults (Graeme, 27 Oct
-- 2026: "I just want it to be set as a fixed template, and just be able to
-- select any template for any recipe... Calzone labels are always 140 x 94,
-- and the mayo labels are always the 102 by 25."). Objective D.
--
-- A template's size is now its "format" (lib/product-labels formats.ts):
-- templates without one are the 140 x 94 back label, so the existing four
-- need no change for that, and no published label's snapshot changes.
--
-- 1. Fried chicken template: the default for the "Fried Chicken" category.
-- 2. Standard calzone template: the default for "Calzones" (it already was,
--    as the standard one; now it's explicit).
--    Both only when the template has no categories set. Category defaults
--    only decide WHICH template a recipe that hasn't picked one gets; every
--    fried chicken recipe has already picked Fried chicken, and calzones get
--    the same template id as before, so no label changes.
-- 3. Adds the "Garlic mayo" template (the "garlic-mayo" preset, format
--    small-102x25, after enforceLegalMinimums, as "Add a template" stores
--    it) if there isn't one of that name. No default category: the mayo
--    recipe picks it by hand.
-- 4. Recipe 31 "TCK Garlic Mayo 200ml": pointed at Garlic mayo only if it
--    has picked no template, and its label barcode set to Shopify's
--    97748478844497 only if it has none, and its name on the label to "TCK
--    Garlic Mayo" (as printed today, without "200ml") only if it has none —
--    only while the recipe name still matches. No recipe that already picked
--    a template changes template.
--
-- Safe to run twice.

UPDATE product_label_templates
   SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{defaultForCategories}', '["Fried Chicken"]'::jsonb),
       version = version + 1, updated_at = NOW(), updated_by_name = 'Label formats (release)'
 WHERE lower(trim(name)) = 'fried chicken'
   AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(settings->'defaultForCategories') = 'array' THEN settings->'defaultForCategories' END), 0) = 0;

UPDATE product_label_templates
   SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{defaultForCategories}', '["Calzones"]'::jsonb),
       version = version + 1, updated_at = NOW(), updated_by_name = 'Label formats (release)'
 WHERE lower(trim(name)) = 'standard calzone label'
   AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(settings->'defaultForCategories') = 'array' THEN settings->'defaultForCategories' END), 0) = 0;

INSERT INTO product_label_templates (name, settings, updated_at, updated_by_name)
SELECT 'Garlic mayo', '{"format":"small-102x25","page":{"widthMm":102,"heightMm":25,"dpi":203,"marginMm":4.5,"columnSplitPct":41,"columnGapMm":3,"titleBandMm":7,"stepsBandMm":8,"bandGapMm":3,"fieldGapMm":3,"dividerOn":true,"dividerMm":0.25,"stepCircleAuto":true,"stepCircleMm":5.5,"barcodeHeightMm":15,"barcodeSizePct":151,"smallPack":false},"fields":{"title":{"width":"normal","narrowest":"condensed","weight":700,"minPt":12,"maxPt":22,"letterSpacingEm":0,"lineHeight":1,"bold":true,"caps":true,"align":"center"},"subtitle":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":9,"letterSpacingEm":0,"lineHeight":1.1,"bold":false,"caps":false,"align":"center"},"steps":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":10.5,"letterSpacingEm":0,"lineHeight":1.1,"bold":false,"caps":false,"align":"left"},"headings":{"width":"normal","narrowest":"normal","weight":700,"minPt":12.5,"maxPt":12.5,"letterSpacingEm":0,"lineHeight":1.1,"bold":true,"caps":true,"align":"left"},"storage":{"width":"semi-condensed","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":10.5,"letterSpacingEm":0,"lineHeight":1.12,"bold":false,"caps":false,"align":"left"},"dates":{"width":"semi-condensed","narrowest":"semi-condensed","weight":700,"minPt":6.75,"maxPt":10,"letterSpacingEm":0,"lineHeight":1.12,"bold":true,"caps":false,"align":"left"},"ingredients":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":10.5,"letterSpacingEm":0,"lineHeight":1.12,"bold":false,"caps":false,"align":"left"},"allergenInfo":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":9,"letterSpacingEm":0,"lineHeight":1.12,"bold":false,"caps":false,"align":"left"},"address":{"width":"normal","narrowest":"semi-condensed","weight":400,"minPt":6.75,"maxPt":8,"letterSpacingEm":0,"lineHeight":1.12,"bold":false,"caps":false,"align":"left"}},"text":{"title":"{name}","subtitle":"","storageHeading":"STORAGE INSTRUCTIONS:","storage":"Keep chilled below 5°C, or freeze immediately and keep below -18°C. Defrost fully in the fridge before cooking and eat within 24 hours of defrosting.","chilledLabel":"USE BY:","frozenLabel":"IF FROZEN USE BY:","batchLabel":"BATCH:","ingredientsHeading":"THE INGREDIENTS:","allergenNote":"Allergens are shown in **Bold**.","warning":"**WARNING:** Whilst every effort has been made to remove all bones, some may remain.","address":"Handcrafted at The Calzone Kitchen, Unit 1b, Lower Rectory Farm, Mill Lane, Great Brickhill, Buckinghamshire, MK17 9FX","steps":[]},"cooking":{"ovenTempC":null,"fanTempC":null,"ovenMinMinutes":null,"ovenMaxMinutes":null,"airFryerTempC":null,"airFryerMinMinutes":null,"airFryerMaxMinutes":null},"cookingTiers":{"on":false,"tiers":[{"key":"light","name":"Light","maxWeightG":260,"maxMeatG":20,"cooking":{"ovenTempC":null,"fanTempC":null,"ovenMinMinutes":14,"ovenMaxMinutes":16,"airFryerTempC":165,"airFryerMinMinutes":12,"airFryerMaxMinutes":15}},{"key":"medium","name":"Medium","maxWeightG":330,"maxMeatG":45,"cooking":{"ovenTempC":null,"fanTempC":null,"ovenMinMinutes":16,"ovenMaxMinutes":19,"airFryerTempC":null,"airFryerMinMinutes":14,"airFryerMaxMinutes":17}},{"key":"heavy","name":"Heavy","maxWeightG":null,"maxMeatG":null,"cooking":{"ovenTempC":null,"fanTempC":null,"ovenMinMinutes":18,"ovenMaxMinutes":22,"airFryerTempC":null,"airFryerMinMinutes":16,"airFryerMaxMinutes":19}}],"maxOvenMinutes":22,"maxAirFryerMinutes":19,"categories":{"meat":["raw_meat","cooked_meat"],"veg":["vegetable"],"cheese":["cheese","dairy"],"dough":["dough"]}},"chilledDefault":{"amount":38,"unit":"days"},"frozenDefault":null,"batchBasis":"print-day","mayContainBoldList":true,"boneRiskWords":[],"storageBanner":{"on":false,"text":"KEEP FROZEN","snowflake":true,"heightMm":6.5},"chilledUseByOn":true,"netQuantity":{"on":false,"sizePt":16},"warningPlacement":"allergens","defaultForCategories":[]}'::jsonb, NOW(), 'Label formats (release)'
 WHERE NOT EXISTS (SELECT 1 FROM product_label_templates WHERE lower(trim(name)) = 'garlic mayo');

WITH tpl AS (
  SELECT id FROM product_label_templates WHERE lower(trim(name)) = 'garlic mayo' ORDER BY id LIMIT 1
)
INSERT INTO product_label_settings (recipe_id, template_id, barcode, label_name, updated_at, updated_by_name)
SELECT r.id, tpl.id, '97748478844497', 'TCK Garlic Mayo', NOW(), 'Label formats (release)'
  FROM recipes r CROSS JOIN tpl
 WHERE r.id = 31 AND r.name ILIKE 'TCK Garlic Mayo%'
ON CONFLICT (recipe_id) DO UPDATE
   SET template_id = COALESCE(product_label_settings.template_id, EXCLUDED.template_id),
       barcode = COALESCE(NULLIF(trim(product_label_settings.barcode), ''), EXCLUDED.barcode),
       label_name = COALESCE(NULLIF(trim(product_label_settings.label_name), ''), EXCLUDED.label_name),
       updated_at = EXCLUDED.updated_at,
       updated_by_name = EXCLUDED.updated_by_name
 WHERE product_label_settings.template_id IS NULL
    OR NULLIF(trim(product_label_settings.barcode), '') IS NULL
    OR NULLIF(trim(product_label_settings.label_name), '') IS NULL;
