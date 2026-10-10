-- Test prints from the label review page (Graeme, 2026-10-12): every
-- back-label print run now says what it was —
--   'production'  made at the wrapping station for real packs
--   'test'        a test print from /labels/:id (count usually 1, dated
--                 today) — never counted as labels put on product
-- A test print of a recipe that has no live label yet prints the CURRENT
-- proof stamped "TEST — NOT FOR SALE", so it has no live version to point
-- at: version_no becomes optional (label_version_id already is).
ALTER TABLE product_label_prints
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'production';

ALTER TABLE product_label_prints
  DROP CONSTRAINT IF EXISTS product_label_prints_kind_check;
ALTER TABLE product_label_prints
  ADD CONSTRAINT product_label_prints_kind_check CHECK (kind IN ('production', 'test'));

ALTER TABLE product_label_prints
  ALTER COLUMN version_no DROP NOT NULL;
