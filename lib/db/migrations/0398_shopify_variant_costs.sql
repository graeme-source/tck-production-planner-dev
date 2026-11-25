-- A cost per item set by hand for a Shopify product (Graeme, 25 Nov 2026:
-- "from this window, click on this product and set the price in our
-- system"). Set from Founder → Numbers → Order Analysis → an order's
-- contents, for an item with no recipe, no linked supply and no Shopify
-- cost per item. Order Analysis and the P&L cost a Shopify variant from,
-- first that has one: its recipe (main, F2F or wonky) → a linked supply →
-- this table → Shopify's cost per item (api lib/finance/profit-tracker.ts
-- pickVariantCosting).
--
--   cost      £ per item sold (one Shopify unit), ex VAT.
--   category  'food' | 'packaging' — which P&L line it counts on.
--
-- Objective I. Safe to run twice.

CREATE TABLE IF NOT EXISTS shopify_variant_costs (
  variant_id TEXT PRIMARY KEY,
  title TEXT,
  cost NUMERIC(10,4) NOT NULL,
  category TEXT NOT NULL DEFAULT 'food',
  set_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  set_by_name TEXT,
  set_at TIMESTAMP NOT NULL DEFAULT NOW()
);
