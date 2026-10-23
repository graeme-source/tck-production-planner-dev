-- What each ingredient's pack is called (fix-queue #327, Jane Miles;
-- Graeme approved 22 Oct 2026). Objective C.
--
-- "When we stock check Mozzarella, we count in boxes but this is displayed
-- as packs, which is misleading and can give a false reading."
--
--   ingredients.pack_name   'box' | 'bag' | 'roll' | 'tub' | 'case' | …
--       (the list is PACK_NAMES in @workspace/units). NULL = the old
--       wording, "pack" (or "bottle" for liquids). Used wherever the word
--       pack shows: stock checks ("Count BOXES (1 box = 12 kg)"), goods-in,
--       Orders and kanban. Display only — stock maths is unchanged.
--
-- No seed: Jane / Graeme set it per ingredient on the Ingredients page.

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS pack_name TEXT;
