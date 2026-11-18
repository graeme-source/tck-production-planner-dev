-- Profit tracker on the founder P&L page (Graeme, 18 Nov 2026). Objective I
-- (finance & reporting). Safe to run twice.
--
-- pnl_account_buckets: which planner cost line each QuickBooks P&L account
-- belongs to. Keyed by the account's name, lower-case with single spaces, so
-- "Food Purchases  TCK Delivered" and "food purchases tck delivered" match.
-- A bucket on a parent account covers its sub-accounts unless one has its
-- own. Accounts with no row fall back to their P&L group (Income → income,
-- Expenses → overhead, Other income/expenses → below the line; Cost of Sales
-- → "other cost of sales", flagged for a decision). Graeme edits these on
-- the page; the rows below are the starting point from the Apr–Sep 2026
-- export (docs/PNL_QUICKBOOKS_MAPPING.md).

CREATE TABLE IF NOT EXISTS pnl_account_buckets (
  account_key TEXT PRIMARY KEY,
  account_name TEXT NOT NULL,
  bucket TEXT NOT NULL CHECK (bucket IN (
    'income', 'food', 'packaging', 'courier', 'payment_fees', 'production_labour',
    'other_cost_of_sales', 'advertising', 'overhead', 'below_line', 'ignore'
  )),
  updated_by_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO pnl_account_buckets (account_key, account_name, bucket) VALUES
  ('cost of tck delivered', 'Cost of TCK Delivered', 'food'),
  ('food purchases tck delivered', 'Food Purchases  TCK Delivered', 'food'),
  ('cost of sales', 'Cost of sales', 'food'),
  ('duty and import costs', 'Duty and Import Costs', 'food'),
  ('inventory shrinkage', 'Inventory Shrinkage', 'food'),
  ('packaging - cos -tckd', 'Packaging - COS -TCKD', 'packaging'),
  ('courier services - tckd', 'Courier Services - TCKD', 'courier'),
  ('shopify fees', 'Shopify Fees', 'payment_fees'),
  ('direct wages cost', 'Direct Wages Cost', 'production_labour'),
  ('events costs', 'Events Costs', 'other_cost_of_sales'),
  ('advertising and promotion', 'Advertising and Promotion', 'advertising')
ON CONFLICT (account_key) DO NOTHING;

-- Courier price per parcel, by box size (APC, flat apart from a few
-- outlying postcodes). Box prices (small_box_cost / large_box_cost) already
-- live here. overhead_average_months: how many complete QuickBooks months
-- the overheads are averaged over.
INSERT INTO pnl_settings (key, value)
SELECT v.key, v.value FROM (VALUES
  ('small_box_courier', '4.72'),
  ('large_box_courier', '5.72'),
  ('overhead_average_months', '3')
) AS v(key, value)
WHERE NOT EXISTS (SELECT 1 FROM pnl_settings s WHERE s.key = v.key);
