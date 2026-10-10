-- Product labels, Stage 1 (Graeme, 2026-10-10) — the in-app replacement for
-- the Label LIVE desktop app. Objectives A (label data generated, not
-- re-keyed), D (a lawful, traceable label) and F (a recipe edit can never
-- silently change what prints).
--
-- product_label_templates   the label design: size, dpi, typography per
--                           field, fixed wording, default cooking + frozen
--                           values (settings = JSON, see lib/product-labels
--                           template.ts). version goes up on every save.
--                           The app fills an empty row with the defaults the
--                           first time it reads it.
-- product_label_settings    per recipe: barcode number, label name, cooking
--                           overrides (oven + air fryer; NULL = template
--                           default), bones warning, chilled / frozen use-by
--                           periods (NULL = recipe shelf life / template).
-- product_label_versions    the PUBLISHED ("live") label of a recipe, one row
--                           per publish: a frozen snapshot of every input
--                           (snapshot_hash = SHA-256 of its canonical JSON),
--                           the fit result, who and when. The live label is
--                           the highest version_no. Rows outlive the recipe
--                           (recipe_id SET NULL) — they are the record of
--                           what was printed.

CREATE TABLE IF NOT EXISTS product_label_templates (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  settings         JSONB NOT NULL DEFAULT '{}'::jsonb,
  version          INTEGER NOT NULL DEFAULT 1,
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by_id    INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_name  TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO product_label_templates (name)
SELECT 'Standard calzone label'
WHERE NOT EXISTS (SELECT 1 FROM product_label_templates);

CREATE TABLE IF NOT EXISTS product_label_settings (
  recipe_id               INTEGER PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
  template_id             INTEGER REFERENCES product_label_templates(id) ON DELETE SET NULL,
  barcode                 TEXT,
  label_name              TEXT,
  oven_on                 BOOLEAN NOT NULL DEFAULT TRUE,
  air_fryer_on            BOOLEAN NOT NULL DEFAULT TRUE,
  oven_temp_c             INTEGER,
  fan_temp_c              INTEGER,
  oven_min_minutes        INTEGER,
  oven_max_minutes        INTEGER,
  air_fryer_temp_c        INTEGER,
  air_fryer_min_minutes   INTEGER,
  air_fryer_max_minutes   INTEGER,
  warning_on              BOOLEAN NOT NULL DEFAULT TRUE,
  chilled_amount          INTEGER,
  chilled_unit            TEXT,
  frozen_on               BOOLEAN NOT NULL DEFAULT TRUE,
  frozen_amount           INTEGER,
  frozen_unit             TEXT,
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by_name         TEXT,
  CONSTRAINT product_label_settings_chilled_unit CHECK (chilled_unit IS NULL OR chilled_unit IN ('days','weeks','months','years')),
  CONSTRAINT product_label_settings_frozen_unit CHECK (frozen_unit IS NULL OR frozen_unit IN ('days','weeks','months','years'))
);

CREATE TABLE IF NOT EXISTS product_label_versions (
  id                 SERIAL PRIMARY KEY,
  recipe_id          INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  recipe_name        TEXT NOT NULL,
  version_no         INTEGER NOT NULL,
  snapshot           JSONB NOT NULL,
  snapshot_hash      TEXT NOT NULL,
  fit                JSONB NOT NULL,
  template_id        INTEGER,
  template_version   INTEGER,
  published_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  published_by_id    INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  published_by_name  TEXT,
  CONSTRAINT product_label_versions_recipe_version UNIQUE (recipe_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_product_label_versions_recipe
  ON product_label_versions (recipe_id, version_no DESC);
