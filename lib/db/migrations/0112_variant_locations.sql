-- The fridge map moves from SKU to VARIANT (Graeme, 2026-09-17).
--
-- SKUs at TCK are shelf labels, not identities: 189 Shopify variants share
-- just 41 distinct SKUs, and five different products sit on "4a" alone. A map
-- keyed by SKU can therefore only ever hold 41 things, and which product
-- claims each bin is arbitrary. That is why Big Nanny's Macaroni Cheese could
-- not be found on the Bin Locations page at all (Garlic Cheese had taken 4a),
-- why most of the brownies, the sauces and the fried chicken variants were
-- missing, and why the pick walk listed the same product twice.
--
-- The barcode/image lookup was moved to variant_id for exactly this reason
-- ("a SKU-keyed lookup can attach the wrong product's barcode to a line
-- item"); locations were left behind.
--
-- The backfill reproduces TODAY's pick order exactly: every variant inherits
-- the bin its own SKU currently points at, so nothing moves in the walk on
-- the day this ships. Rearranging then happens by dragging on the page.
--
-- sku_locations is deliberately LEFT IN PLACE and unread by the app, as the
-- rollback path for this deploy. A later migration can drop it once the
-- variant map has been in daily use.

CREATE TABLE IF NOT EXISTS variant_locations (
  variant_id     text PRIMARY KEY,
  zone           storage_zone NOT NULL,
  location_label text NOT NULL,
  door           integer,
  shelf          text,
  updated_at     timestamp NOT NULL DEFAULT now()
);

INSERT INTO variant_locations (variant_id, zone, location_label, door, shelf, updated_at)
SELECT b.variant_id, l.zone, l.location_label, l.door, l.shelf, now()
  FROM sku_locations l
  JOIN sku_barcodes b ON b.sku = l.sku
    ON CONFLICT (variant_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS variant_locations_walk_idx ON variant_locations (zone, door, shelf);
