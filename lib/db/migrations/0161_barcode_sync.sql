-- Barcodes are set in the app; our database is the source of truth for
-- scanning (Graeme, 2026-10-10). Shopify is only ever READ.
-- Objectives A (a recipe's Shopify link is complete in one place) and F (a
-- barcode change scans on the packing screen straight away — no manual sync).
--
-- ONE barcode per Shopify variant, in ONE place: sku_barcodes (keyed by
-- variant_id since 0034 — SKUs are shelf labels, not identities). It was a
-- cache filled only by the manual "Sync from Shopify" button; it becomes the
-- source of truth for every variant linked to a recipe:
--   - the packing scanner reads it (unchanged: /api/fulfilment/orders, plus
--     a live map the packing page refreshes every few seconds);
--   - the pack label reads the recipe's pack barcode from it
--     (product_label_settings.barcode is no longer read — left in place
--     as the rollback path; any number typed there is carried over below);
--   - the recipe page sets it here (GTIN + duplicate checks).
-- Variants NOT linked to a recipe still follow Shopify, refreshed hourly. A
-- difference on a linked variant is shown as "Different in Shopify" (Shopify's
-- barcode also feeds Google Shopping GTINs) with one action, "Use Shopify's".
--
-- New columns:
--   shopify_product_id   the variant's product (how an 8-pack bag is found
--                        beside its 2-pack)
--   shopify_barcode      what Shopify had at the last check
--   shopify_checked_at   when that check was
--   shopify_missing      the variant wasn't in Shopify at the last check
--   barcode_source       'shopify' | 'app' | 'label' — where OUR value came from
--   barcode_set_at / _by_id / _by_name   who last set ours (app, pull or "Use Shopify's")
--   shopify_product_status  'active' | 'draft' | 'archived' at the last check.
--                        A variant is CURRENT when linked to an active recipe
--                        or its Shopify product is active; a RETIRED variant
--                        never claims a barcode (Graeme reuses retired
--                        products' GS1 numbers — lib/barcodes identity.ts).
--   same_product_as      variant id this listing is the same physical product
--                        as (an F2F / CFF / discounted copy), set by a person:
--                        it may then share that product's barcode.
-- barcode becomes nullable: a linked variant with no barcode yet still has a
-- row, so the recipe page can show the empty field.
--
-- barcode_events: every set (and refused set), move (a barcode released from
-- the product it was taken from), "Use Shopify's", "same product as", pull
-- fill, hourly follow and scan-queue fill — who, old → new, result, message.
-- Rows outlive the recipe.
--
-- packing_scan_rejections: every scan the packing screen refused or could
-- not match — who, which order, the code, the reason ("Wrong item — this
-- is …"), so mis-scans can be seen and fixed at the cause.

ALTER TABLE sku_barcodes ALTER COLUMN barcode DROP NOT NULL;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS shopify_product_id TEXT;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS shopify_barcode TEXT;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS shopify_checked_at TIMESTAMPTZ;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS shopify_missing BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS barcode_source TEXT NOT NULL DEFAULT 'shopify';
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS barcode_set_at TIMESTAMPTZ;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS barcode_set_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS barcode_set_by_name TEXT;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS shopify_product_status TEXT;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS same_product_as TEXT;

DO $$ BEGIN
  ALTER TABLE sku_barcodes ADD CONSTRAINT sku_barcodes_source_check CHECK (barcode_source IN ('shopify', 'app', 'label'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Every existing row came from Shopify via the manual sync, so that is what
-- Shopify had when it last ran.
UPDATE sku_barcodes
   SET shopify_barcode = barcode,
       shopify_checked_at = updated_at
 WHERE shopify_checked_at IS NULL AND barcode_source = 'shopify';

CREATE TABLE IF NOT EXISTS barcode_events (
  id            SERIAL PRIMARY KEY,
  variant_id    TEXT NOT NULL,
  recipe_id     INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  product_name  TEXT,
  action        TEXT NOT NULL,
  old_barcode   TEXT,
  new_barcode   TEXT,
  result        TEXT NOT NULL,
  message       TEXT,
  user_id       INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  user_name     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT barcode_events_action CHECK (action IN ('set', 'move', 'use-shopify', 'same-product', 'pull-fill', 'follow', 'scan-fill')),
  CONSTRAINT barcode_events_result CHECK (result IN ('ok', 'refused'))
);

CREATE INDEX IF NOT EXISTS barcode_events_variant_idx ON barcode_events (variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS barcode_events_created_idx ON barcode_events (created_at DESC);

CREATE TABLE IF NOT EXISTS packing_scan_rejections (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  user_name    TEXT,
  order_id     TEXT,
  order_name   TEXT,
  code         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  message      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT packing_scan_rejections_kind CHECK (kind IN ('wrong-item', 'ambiguous', 'unknown-barcode', 'no-match', 'already-picked'))
);

CREATE INDEX IF NOT EXISTS packing_scan_rejections_created_idx ON packing_scan_rejections (created_at DESC);

-- Carry over any barcode typed on the pack-label page (0158) onto the
-- recipe's pack listings — but only where we hold no barcode for that
-- variant yet. A different number already held (from Shopify) wins; the
-- label then shows that one and flags "Label update needed" if it was live.
-- Logged as a 'set' so the history shows where the number came from.
DO $$ BEGIN
  IF to_regclass('public.recipe_shopify_mappings') IS NOT NULL THEN
    WITH carried AS (
    INSERT INTO sku_barcodes (variant_id, barcode, barcode_source, barcode_set_at, barcode_set_by_name, product_title, variant_title)
    SELECT DISTINCT ON (m.shopify_variant_id)
           m.shopify_variant_id, pls.barcode, 'label', pls.updated_at, pls.updated_by_name,
           m.shopify_product_title, m.shopify_variant_title
      FROM product_label_settings pls
      JOIN recipe_shopify_mappings m ON m.recipe_id = pls.recipe_id
     WHERE pls.barcode IS NOT NULL AND pls.barcode <> ''
     ORDER BY m.shopify_variant_id
    ON CONFLICT (variant_id) DO UPDATE
       SET barcode = EXCLUDED.barcode,
           barcode_source = 'label',
           barcode_set_at = EXCLUDED.barcode_set_at,
           barcode_set_by_name = EXCLUDED.barcode_set_by_name
     WHERE sku_barcodes.barcode IS NULL
    RETURNING variant_id, barcode, barcode_set_by_name
    )
    INSERT INTO barcode_events (variant_id, action, new_barcode, result, message, user_name)
    SELECT variant_id, 'set', barcode, 'ok', 'carried over from the pack-label page (migration 0161)', barcode_set_by_name
      FROM carried;
  END IF;
END $$;
