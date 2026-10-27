-- Barcodes: one source of truth, set from the product label page or the
-- recipe page, sent to Shopify and adopted from it (Graeme, 2026-10-12;
-- built as 0182 on 12 Oct, renumbered 0326 when ported onto master on
-- 2026-10-27). Objectives A, D and F.
--
-- sku_barcodes stays the ONE place a barcode lives (keyed by Shopify
-- variant). This migration adds:
--
-- 1. Push state per variant — what happened when the app's barcode was last
--    sent to Shopify (shown on the card: "Sent to Shopify ✓", "Sending…",
--    "Not sent — reason" with Retry):
--      shopify_push_state    'sending' | 'sent' | 'waiting' | 'failed' | 'conflict' | 'skipped'
--      shopify_push_barcode  the number that state is about
--      shopify_push_from     what Shopify had when it was decided (a Retry
--                            may replace only that, never a newer number)
--      shopify_push_at       when
--      shopify_push_message  why (e.g. "Shopify writes are switched off")
--
-- 2. barcode_events logs every push (who, when, variant, Shopify's number →
--    ours, result) plus adopts and barcodes held before a listing exists.
--    New actions: 'push', 'adopt', 'pending-set', 'pending-apply'.
--    New results: 'failed', 'waiting', 'skipped', 'conflict'.
--
-- 3. recipe_pending_barcodes — a barcode set for a recipe BEFORE it has a
--    Shopify listing (a new recipe or label usually has none yet). Held
--    against the product identity (recipe + kind); the label prints it at
--    once; when a listing is linked it moves onto sku_barcodes (and the row
--    here is deleted) and is sent to Shopify — or flagged as a disagreement
--    if Shopify already has a different number. A row exists here ONLY while
--    no listing of that kind is linked, so there is still one value per
--    product.
--
-- 4. product_label_settings.barcode is folded in but KEPT. The 12 Oct build
--    dropped it, but master has since started using it again: a small label
--    (102 x 25 mm format, e.g. the garlic mayo pot) falls back to it when
--    the recipe's pack listing gives no barcode (lib/product-labels-store.ts),
--    and migration 0280 writes the garlic mayo's number into it. So a number
--    in it for a recipe with NO Shopify listing becomes that recipe's held
--    pack barcode (printed, and sent to Shopify when a listing is linked);
--    the column itself is left exactly as it is.
--
-- Safe to run twice: every step is IF NOT EXISTS / ON CONFLICT DO NOTHING,
-- and the fold only logs the rows it actually inserts.

ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS shopify_push_state TEXT;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS shopify_push_barcode TEXT;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS shopify_push_from TEXT;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS shopify_push_at TIMESTAMPTZ;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS shopify_push_message TEXT;

DO $$ BEGIN
  ALTER TABLE sku_barcodes ADD CONSTRAINT sku_barcodes_push_state_check
    CHECK (shopify_push_state IS NULL OR shopify_push_state IN ('sending', 'sent', 'waiting', 'failed', 'conflict', 'skipped'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE barcode_events DROP CONSTRAINT IF EXISTS barcode_events_action;
ALTER TABLE barcode_events ADD CONSTRAINT barcode_events_action CHECK (action IN (
  'set', 'move', 'use-shopify', 'same-product', 'pull-fill', 'follow', 'scan-fill',
  'push', 'adopt', 'pending-set', 'pending-apply'
));
ALTER TABLE barcode_events DROP CONSTRAINT IF EXISTS barcode_events_result;
ALTER TABLE barcode_events ADD CONSTRAINT barcode_events_result CHECK (result IN (
  'ok', 'refused', 'failed', 'waiting', 'skipped', 'conflict'
));

CREATE TABLE IF NOT EXISTS recipe_pending_barcodes (
  recipe_id    INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  barcode      TEXT NOT NULL,
  set_by_id    INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  set_by_name  TEXT,
  set_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (recipe_id, kind),
  CONSTRAINT recipe_pending_barcodes_kind CHECK (kind IN ('pack', 'bag', 'wonky'))
);

-- Fold the label-settings number in for recipes with no Shopify listing
-- (it becomes their held pack barcode). The column is NOT dropped.
WITH held AS (
  INSERT INTO recipe_pending_barcodes (recipe_id, kind, barcode, set_by_name, set_at)
  SELECT pls.recipe_id, 'pack', regexp_replace(pls.barcode, '[\s-]+', '', 'g'), pls.updated_by_name, COALESCE(pls.updated_at, NOW())
    FROM product_label_settings pls
   WHERE pls.barcode IS NOT NULL AND btrim(pls.barcode) <> ''
     AND NOT EXISTS (SELECT 1 FROM recipe_shopify_mappings m WHERE m.recipe_id = pls.recipe_id)
  ON CONFLICT (recipe_id, kind) DO NOTHING
  RETURNING recipe_id, barcode, set_by_name
)
INSERT INTO barcode_events (variant_id, recipe_id, action, new_barcode, result, message, user_name)
SELECT 'recipe:' || recipe_id, recipe_id, 'pending-set', barcode, 'ok',
       'copied from the label settings (migration 0326) — no Shopify listing yet', set_by_name
  FROM held;
