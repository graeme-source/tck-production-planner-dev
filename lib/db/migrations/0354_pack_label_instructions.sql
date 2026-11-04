-- Storage and warming instructions on the two-label pack (Graeme, 4 Nov 2026,
-- red wine gravy reduction): they go on the barcode label under their own
-- headings. Sets the wording on the "Small label with ingredients" template if
-- it has none. Changes what the label prints, so the recipe shows "label update
-- needed" until republished. Editable afterwards on the template's design page.
-- Objective D.
--
-- Safe to run twice.

UPDATE product_label_templates
   SET settings = jsonb_set(
         jsonb_set(settings, '{text,packStorage}', to_jsonb('Keep chilled below 5°C.'::text)),
         '{text,packWarming}',
         to_jsonb('Pour into a microwave-proof container. Warm in the microwave for 30 seconds, or until it reaches your desired temperature.'::text)),
       updated_at = NOW(),
       updated_by_name = 'Pack label instructions (release)'
 WHERE settings->>'format' = 'pair-102x25'
   AND COALESCE(trim(settings#>>'{text,packStorage}'), '') = ''
   AND COALESCE(trim(settings#>>'{text,packWarming}'), '') = '';
