-- Product labels: the ingredients text is never bigger than the storage
-- instructions text (Graeme, 2026-10-12). A short ingredient list such as
-- the Margherita grew to 11 pt — bigger than the 10.5 pt storage text — and
-- looked like the most important thing on the label. Objective D.
--
-- On every saved template whose ingredients maximum is above its storage
-- maximum, the ingredients maximum comes down to match. Long lists already
-- shrink below this, so only short ones change. Re-running finds nothing to
-- change. Version up by one, like a save from Label design.
UPDATE product_label_templates
SET settings = jsonb_set(settings, '{fields,ingredients,maxPt}', settings #> '{fields,storage,maxPt}'),
    version = version + 1,
    updated_at = NOW(),
    updated_by_name = 'Ingredients no bigger than storage (release)'
WHERE jsonb_typeof(settings #> '{fields,storage,maxPt}') = 'number'
  AND jsonb_typeof(settings #> '{fields,ingredients,maxPt}') = 'number'
  AND (settings #>> '{fields,ingredients,maxPt}')::numeric > (settings #>> '{fields,storage,maxPt}')::numeric;
