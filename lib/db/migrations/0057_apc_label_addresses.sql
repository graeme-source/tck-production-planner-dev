-- Operator-corrected delivery addresses for APC labels.
--
-- APC allows 35 characters per address line. Where a Shopify address doesn't
-- fit, the normaliser cuts it, and the cut can remove the part that actually
-- finds the door ("…Somercotes, Van 313 The Lawns" loses the van number).
-- A row here is a human's decision about what the driver needs, applied to
-- this order's label only — the Shopify order is never modified, so the
-- customer's own record stays intact.
--
-- One row per order: the latest correction wins and re-editing updates in
-- place, which is what the UNIQUE constraint enforces.
CREATE TABLE IF NOT EXISTS apc_label_addresses (
  id SERIAL PRIMARY KEY,
  shopify_order_id BIGINT NOT NULL UNIQUE,
  shopify_order_name TEXT,
  address1 TEXT NOT NULL,
  address2 TEXT,
  city TEXT NOT NULL,
  postcode TEXT NOT NULL,
  company_name TEXT,
  instructions TEXT,
  original_address1 TEXT,
  original_address2 TEXT,
  original_city TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_name TEXT
);
CREATE INDEX IF NOT EXISTS ix_apc_label_addresses_order ON apc_label_addresses (shopify_order_id);
