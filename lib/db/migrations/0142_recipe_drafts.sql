-- Recipe drafts (Graeme, 2026-10-02). Objectives A (a new recipe idea gets
-- to customers without surprises) and F (a recipe list that stays
-- manageable). A recipe now has three stages:
--
--   Draft        being developed — we might make it, but it isn't ready.
--                Kept out of every production picker (plans, queued
--                production, stock, sales, cases, defects, surveys), but
--                still costed, decked, labelled and trialled in test boxes.
--   On the menu  what we actually make (core menu, specials, test products).
--   Archived     made before, not any more (archived_at, migration 0141).
--
-- Stage = archived if archived_at is set; else draft if is_draft; else on
-- the menu. is_draft survives archiving, so restoring an archived draft puts
-- it back in Drafts.
--
-- is_draft            FALSE = on the menu (every existing recipe unchanged,
--                     apart from the data step below)
-- drafted_at / _by    when, and by whom, it last became a draft
-- published_at / _by  when, and by whom, it last went on the menu
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS drafted_at TIMESTAMP;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS drafted_by_name TEXT;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS published_at TIMESTAMP;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS published_by_name TEXT;

-- Data step: recipes the team already tagged "Draft" (any case) become
-- drafts. Matched on the tag, never on ids or names. A draft can't be on the
-- menu, so a Draft-tagged recipe that is still ticked Core menu or the
-- current special is LEFT on the menu rather than silently unticked — move
-- it to Drafts from the Recipes page if that's what's wanted. The tag itself
-- is left alone.
UPDATE recipes
   SET is_draft = TRUE,
       drafted_at = NOW()
 WHERE is_draft = FALSE
   AND is_core_menu IS NOT TRUE
   AND is_current_special IS NOT TRUE
   AND EXISTS (SELECT 1 FROM unnest(tags) AS t WHERE lower(trim(t)) = 'draft');
