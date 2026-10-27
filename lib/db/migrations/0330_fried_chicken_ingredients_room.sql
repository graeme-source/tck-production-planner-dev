-- Fried chicken: room for the long ingredient decks (Graeme, 27 Oct 2026).
-- The Korean Fried Chicken deck grew and the address no longer fitted at the
-- bottom of the ingredients column. Two new template settings, both off on
-- every other template (and left out of every published label's hash):
--   * allergenNoteAfterMayContain — "For allergens, see ingredients in bold."
--     runs on after the may-contain sentence instead of taking its own line;
--   * page.ingredientsGapMm = 1.5 — the ingredients column's gaps (deck →
--     allergen lines → address) close from 3 mm to 1.5 mm; the storage
--     column keeps its 3 mm.
-- Nothing is made smaller than it was already allowed to go. Objective D.
--
-- Only the "Fried chicken" template, and only while its settings are still
-- the ones this was worked out for (3 mm gaps, the standard fried chicken
-- allergen note, neither new setting there yet), so anything Graeme has
-- changed in Label design stays as he left it. Running it twice changes
-- nothing: the second time the keys are already there.

UPDATE product_label_templates
   SET settings = jsonb_set(
         jsonb_set(settings, '{page,ingredientsGapMm}', '1.5'::jsonb),
         '{allergenNoteAfterMayContain}', 'true'::jsonb),
       version = version + 1, updated_at = NOW(), updated_by_name = 'Room for long ingredient lists (release)'
 WHERE lower(trim(name)) = 'fried chicken'
   AND jsonb_typeof(settings -> 'page') = 'object'
   AND settings -> 'page' -> 'fieldGapMm' = '3'::jsonb
   AND NOT (settings -> 'page' ? 'ingredientsGapMm')
   AND NOT (settings ? 'allergenNoteAfterMayContain')
   AND settings -> 'text' ->> 'allergenNote' = 'For allergens, see ingredients in **bold**.';
