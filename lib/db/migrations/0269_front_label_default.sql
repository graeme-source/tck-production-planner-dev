-- The printed front name label as a product's default front label (Graeme,
-- 27 Oct 2026). Objective D.
--
-- Test products have no professionally printed front label, so the 102 ×
-- 25 mm name label IS their front label. Ticked per recipe on its label
-- page; the wrapping station then makes "Print front labels" the main
-- button for that product. Any product can still print one (e.g. when the
-- printed fronts run out) — this only marks the ones that always need it.

ALTER TABLE product_label_settings
  ADD COLUMN IF NOT EXISTS front_label_printed BOOLEAN NOT NULL DEFAULT false;
