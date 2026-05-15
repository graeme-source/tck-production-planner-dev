-- SKU → barcode lookup, populated from Shopify variants.
--
-- The fulfilment picker (artifacts/production-planner/src/pages/fulfilment.tsx)
-- lets the kitchen mark line items picked by scanning the printed barcode on
-- each product label. Shopify stores barcodes on variants but does not include
-- them in the order line_items payload, so we cache them locally and enrich
-- the /api/fulfilment/orders response with a barcode per line item.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS sku_barcodes (
  sku            text PRIMARY KEY,
  barcode        text NOT NULL,
  product_title  text,
  variant_title  text,
  updated_at     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sku_barcodes_barcode_idx ON sku_barcodes (barcode);

-- image_url added later for the picking page's product thumbnails. Same
-- table because it's the same SKU-keyed cache populated by the same
-- Shopify product sync.
ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS image_url text;
