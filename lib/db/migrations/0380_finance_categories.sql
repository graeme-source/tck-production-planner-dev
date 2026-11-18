-- What an invoice or card transaction is (Graeme, 18 Nov 2026): a fixed
-- choice from a dropdown instead of a typed note, so it's obvious to whoever
-- uploads it and to whoever reads it. Every invoice upload asks "What is
-- this item?". The list is data, editable on Finance — these five are the
-- ones in use today, named as their QuickBooks accounts. Objective I. Safe to run twice.

CREATE TABLE IF NOT EXISTS fin_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Hidden from the dropdown; anything already set keeps it.
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Named EXACTLY as the QuickBooks accounts they're posted to (Graeme,
-- 18 Nov 2026: "no confusion from the bookkeeper") — read from QuickBooks'
-- chart of accounts, including its double space in the food account. Only
-- the five in use; QuickBooks has ~100 and a long list would confuse.
INSERT INTO fin_categories (name, sort_order) VALUES
  ('Food Purchases  TCK Delivered', 10),
  ('Repairs and Maintenance', 20),
  ('Dues and Subscriptions', 30),
  ('Packaging - COS -TCKD', 40),
  ('Cleaning Consumables and Equipment', 50)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE fin_invoices ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES fin_categories(id) ON DELETE SET NULL;
ALTER TABLE fin_lines ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES fin_categories(id) ON DELETE SET NULL;
