-- Re-key the fulfilment barcode cache from SKU to Shopify variant id.
--
-- Why: TCK SKUs are shelf/bin labels ("1", "3b", "5c") shared by many
-- unrelated products. A SKU-keyed cache collapsed all of them into one row
-- per SKU (last synced product wins), so the packing screen showed one
-- product's title with another product's image and barcode — the scanner
-- accepted the WRONG product and rejected the right one (seen 2026-07-30:
-- Buttermilk vs Korean fried chicken strips, both SKU "1").
--
-- The cache is fully rebuilt from Shopify, so wiping it is safe. After
-- deploying + running this, press "Sync from Shopify" on the Bin Locations
-- page (or POST /api/fulfilment/sync-barcodes) to repopulate. Until that
-- sync runs, the picker shows no barcodes/images and falls back to manual
-- SKU/title entry — degraded but never wrong.
--
-- Applied to local tck_live on 2026-07-30. On live this runs automatically
-- at API startup (runStartupMigrations, guarded by _migrations_done key
-- 'sku_barcodes_variant_key_v1') — no manual psql step needed, but the
-- post-deploy "Sync from Shopify" click IS needed to refill the cache.

BEGIN;
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS variant_id text;
DELETE FROM sku_barcodes;
ALTER TABLE sku_barcodes DROP CONSTRAINT IF EXISTS sku_barcodes_pkey;
ALTER TABLE sku_barcodes ALTER COLUMN sku DROP NOT NULL;
ALTER TABLE sku_barcodes ALTER COLUMN variant_id SET NOT NULL;
ALTER TABLE sku_barcodes ADD PRIMARY KEY (variant_id);
COMMIT;
