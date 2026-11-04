-- Storage and warming wording on the two-label pack (Graeme, 4 Nov 2026, red
-- wine gravy reduction): it goes on the barcode label. Sets the wording on the
-- "Small label with ingredients" template if it has none. Changes what the
-- label prints, so the recipe shows "label update needed" until republished.
-- Editable afterwards on the template's design page. Objective D.
--
-- Safe to run twice.

UPDATE product_label_templates
   SET settings = jsonb_set(
         settings, '{text,packInstructions}',
         to_jsonb('Keep chilled below 5°C. Warm in the microwave for 30 seconds, or until it reaches your desired temperature.'::text)),
       updated_at = NOW(),
       updated_by_name = 'Pack label instructions (release)'
 WHERE settings->>'format' = 'pair-102x25'
   AND COALESCE(NULLIF(trim(settings#>>'{text,packInstructions}'), ''), '') = '';
