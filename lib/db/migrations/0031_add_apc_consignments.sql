-- Migration: apc_consignments — APC label-scan ledger
--
-- One row per consignment whose printed label has been scanned onto a Shopify
-- order at the packing bench, recording the 22-digit waybill written to
-- Shopify, the barcode actually scanned, and who scanned it.
--
-- The UNIQUE constraint on waybill is the point of the table: it makes it
-- impossible to scan the same physical label onto two different orders, which
-- was the last remaining way this flow could put the wrong tracking number on
-- a customer's order.
--
-- Applied idempotently at API startup (runStartupMigrations) as well.

CREATE TABLE IF NOT EXISTS apc_consignments (
  id SERIAL PRIMARY KEY,
  waybill TEXT NOT NULL UNIQUE,
  reference TEXT,
  shopify_order_id BIGINT,
  shopify_order_name TEXT,
  consignee_name TEXT,
  consignee_postcode TEXT,
  scanned_barcode TEXT,
  tracking_url TEXT,
  verified_at TIMESTAMP NOT NULL DEFAULT NOW(),
  verified_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  verified_by_name TEXT,
  pushed_to_shopify_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_apc_consignments_order ON apc_consignments (shopify_order_id);
CREATE INDEX IF NOT EXISTS ix_apc_consignments_verified ON apc_consignments (verified_at);

-- Three-state APC mode, replacing the boolean apc_enabled:
--   off       — no courier integration at all (current live state)
--   reconcile — consignments raised by hand in Hypaship; the app looks them up
--               by reference and verifies the scanned label before writing the
--               tracking number to Shopify
--   full      — the app books consignments and prints labels via the API
-- Seeded from the existing apc_enabled flag so no environment changes
-- behaviour on deploy.
INSERT INTO app_settings (key, value, updated_at)
SELECT 'apc_mode',
       CASE WHEN COALESCE((SELECT value FROM app_settings WHERE key = 'apc_enabled'), 'true') = 'false'
            THEN 'off' ELSE 'full' END,
       NOW()
ON CONFLICT (key) DO NOTHING;
