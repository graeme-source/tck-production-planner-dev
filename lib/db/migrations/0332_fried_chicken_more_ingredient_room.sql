-- Fried chicken: more room for the ingredients (Graeme, 27 Oct 2026).
-- After 0330 the live Korean Fried Chicken label still didn't fit: "Address
-- runs 0.9 mm past the bottom of its column" — live's deck is longer than
-- the copy 0330 was worked out on. Three page settings on the Fried chicken
-- template give the ingredients column more width and height, without any
-- text getting smaller than it is today:
--   * bandGapMm 3 -> 2: the space above and below the cooking steps;
--   * columnSplitPct 41 -> 38: the right (ingredients) column is wider;
--   * barcodeSizePct 151 -> 114: the barcode at 3-dot bars instead of 4,
--     still above the standard (100%) size, so it fits the narrower left
--     column.
-- The cooking steps and the storage text print at the same sizes. Fits a
-- deck about 40% longer than the local copy. Objective D.
--
-- Only the "Fried chicken" template, and only while all three are still the
-- values this was worked out from, so anything Graeme has changed in Label
-- design stays as he left it. Running it twice changes nothing.

UPDATE product_label_templates
   SET settings = jsonb_set(
         jsonb_set(
           jsonb_set(settings, '{page,bandGapMm}', '2'::jsonb),
           '{page,columnSplitPct}', '38'::jsonb),
         '{page,barcodeSizePct}', '114'::jsonb),
       version = version + 1, updated_at = NOW(), updated_by_name = 'More room for long ingredient lists (release)'
 WHERE lower(trim(name)) = 'fried chicken'
   AND jsonb_typeof(settings -> 'page') = 'object'
   AND settings -> 'page' -> 'bandGapMm' = '3'::jsonb
   AND settings -> 'page' -> 'columnSplitPct' = '41'::jsonb
   AND settings -> 'page' -> 'barcodeSizePct' = '151'::jsonb;
