-- Barcodes are set in the app and sent to Shopify (Graeme, 2026-10-10).
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
--   - setting it in the app saves here first, then sends it to Shopify.
-- Variants NOT linked to a recipe still follow Shopify, refreshed hourly.
--
-- New columns:
--   shopify_product_id   the variant's product (productVariantsBulkUpdate
--                        needs it; also how an 8-pack bag is found beside
--                        its 2-pack)
--   shopify_barcode      what Shopify had at the last check
--   shopify_checked_at   when that check was
--   shopify_missing      the variant wasn't in Shopify at the last check
--   barcode_source       'shopify' | 'app' | 'label' — where OUR value came from
--   barcode_set_at / _by_id / _by_name   who last set ours (app or "Use Shopify's")
--   push_pending         ours is not yet in Shopify; push_reason says why
--   push_attempted_at / pushed_at        last try / last success
-- barcode becomes nullable: a linked variant with no barcode yet still has a
-- row, so the recipe page can show the empty field.
--
-- barcode_events: every set, push, "Use Shopify's" and pull fill — who, old →
-- new, the result and Shopify's message. Rows outlive the recipe.

ALTER TABLE sku_barcodes ALTER COLUMN barcode DROP NOT NULL;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS shopify_product_id TEXT;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS shopify_barcode TEXT;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS shopify_checked_at TIMESTAMPTZ;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS shopify_missing BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS barcode_source TEXT NOT NULL DEFAULT 'shopify';
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS barcode_set_at TIMESTAMPTZ;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS barcode_set_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS barcode_set_by_name TEXT;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS push_pending BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS push_reason TEXT;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS push_attempted_at TIMESTAMPTZ;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE sku_barcodes ADD CONSTRAINT sku_barcodes_source_check CHECK (barcode_source IN ('shopify', 'app', 'label'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Every existing row came from Shopify via the manual sync, so that is what
-- Shopify had when it last ran.
UPDATE sku_barcodes
   SET shopify_barcode = barcode,
       shopify_checked_at = updated_at
 WHERE shopify_checked_at IS NULL;

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
  CONSTRAINT barcode_events_action CHECK (action IN ('set', 'push', 'use-shopify', 'pull-fill', 'follow')),
  CONSTRAINT barcode_events_result CHECK (result IN ('ok', 'blocked', 'failed', 'refused'))
);

CREATE INDEX IF NOT EXISTS barcode_events_variant_idx ON barcode_events (variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS barcode_events_created_idx ON barcode_events (created_at DESC);

-- Carry over any barcode typed on the pack-label page (0158) onto the
-- recipe's pack listings — but only where we hold no barcode for that
-- variant yet. A different number already held (from Shopify) wins; the
-- label then shows that one and flags "Label update needed" if it was live.
DO $$ BEGIN
  IF to_regclass('public.recipe_shopify_mappings') IS NOT NULL THEN
    INSERT INTO sku_barcodes (variant_id, barcode, barcode_source, barcode_set_at, barcode_set_by_name, push_pending, push_reason, product_title, variant_title)
    SELECT DISTINCT ON (m.shopify_variant_id)
           m.shopify_variant_id, pls.barcode, 'label', pls.updated_at, pls.updated_by_name, TRUE,
           'carried over from the pack-label page — check it, then Retry to send it',
           m.shopify_product_title, m.shopify_variant_title
      FROM product_label_settings pls
      JOIN recipe_shopify_mappings m ON m.recipe_id = pls.recipe_id
     WHERE pls.barcode IS NOT NULL AND pls.barcode <> ''
     ORDER BY m.shopify_variant_id
    ON CONFLICT (variant_id) DO UPDATE
       SET barcode = EXCLUDED.barcode,
           barcode_source = 'label',
           barcode_set_at = EXCLUDED.barcode_set_at,
           barcode_set_by_name = EXCLUDED.barcode_set_by_name,
           push_pending = TRUE,
           push_reason = EXCLUDED.push_reason
     WHERE sku_barcodes.barcode IS NULL;
  END IF;
END $$;
