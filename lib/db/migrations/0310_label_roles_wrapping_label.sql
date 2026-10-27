-- A recipe can have a WRAPPING label as well as its main (back / despatch)
-- label (Graeme, 27 Oct 2026: cinnamon buns get a small internal freezer
-- label at wrapping, and the big despatch label goes over the top when they
-- come out of the freezer). Objective D. Logic: lib/product-labels
-- label-roles.ts.
--
-- 1. product_label_settings.wrapping_template_id — the template the wrapping
--    station prints instead of the main label. NULL = none (as today: the
--    wrapping station prints the main label).
-- 2. product_label_versions.role — 'main' or 'wrapping'. Every existing row
--    is a main label (DEFAULT 'main'), so no published label changes. Each
--    role has its own version numbers, so the unique key becomes
--    (recipe_id, role, version_no).
--
-- Additive only; safe to run twice.

ALTER TABLE product_label_settings
  ADD COLUMN IF NOT EXISTS wrapping_template_id INTEGER
    REFERENCES product_label_templates(id) ON DELETE SET NULL;

ALTER TABLE product_label_versions
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'main';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_label_versions_role_check') THEN
    ALTER TABLE product_label_versions
      ADD CONSTRAINT product_label_versions_role_check CHECK (role IN ('main', 'wrapping'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_label_versions_recipe_role_version') THEN
    ALTER TABLE product_label_versions
      ADD CONSTRAINT product_label_versions_recipe_role_version UNIQUE (recipe_id, role, version_no);
  END IF;
END $$;

ALTER TABLE product_label_versions DROP CONSTRAINT IF EXISTS product_label_versions_recipe_version;

DROP INDEX IF EXISTS idx_product_label_versions_recipe;
CREATE INDEX IF NOT EXISTS idx_product_label_versions_recipe
  ON product_label_versions (recipe_id, role, version_no DESC);
