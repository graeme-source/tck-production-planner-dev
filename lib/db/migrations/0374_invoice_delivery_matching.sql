-- Invoices checked against deliveries (Graeme, 13 Nov 2026): for the
-- suppliers ticked here, Claude reads each invoice's lines so the app can
-- say which goods-in delivery it was for, whether the quantities agree, and
-- gently warn when an invoice has had no delivery for far longer than that
-- supplier usually takes. Prices on invoices that don't match ours go to a
-- review list in Inventory. Objectives F and I. Safe to run twice.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS match_invoices_to_deliveries BOOLEAN NOT NULL DEFAULT FALSE;

-- 'pending' = waiting for Claude to read the lines; 'done' | 'failed';
-- NULL = not wanted (supplier not ticked).
ALTER TABLE fin_invoices ADD COLUMN IF NOT EXISTS lines_status TEXT;
ALTER TABLE fin_invoices ADD COLUMN IF NOT EXISTS lines_read_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS fin_invoice_lines (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES fin_invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  code TEXT,
  description TEXT NOT NULL,
  quantity NUMERIC(14, 4),
  unit TEXT,
  unit_price NUMERIC(14, 4),
  line_total NUMERIC(14, 2),
  -- Delivery, freight, tail-lift, fuel surcharge … not goods.
  is_charge BOOLEAN NOT NULL DEFAULT FALSE,
  -- What Claude thinks it is in our ingredients, and how many of the
  -- ingredient's own unit one invoice unit is (a box of 36 → 36).
  ingredient_id INTEGER,
  native_per_unit NUMERIC(14, 4)
);
CREATE INDEX IF NOT EXISTS ix_fin_invoice_lines_invoice ON fin_invoice_lines (invoice_id);
CREATE INDEX IF NOT EXISTS ix_fin_invoice_lines_ingredient ON fin_invoice_lines (ingredient_id);

-- A person's answer to "this invoice's price doesn't match ours":
-- 'updated' (our price changed to it) or 'dismissed' (leave ours).
CREATE TABLE IF NOT EXISTS ingredient_price_reviews (
  id SERIAL PRIMARY KEY,
  invoice_line_id INTEGER NOT NULL REFERENCES fin_invoice_lines(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL,
  decision TEXT NOT NULL,
  old_cost_per_pack NUMERIC(10, 4),
  new_cost_per_pack NUMERIC(10, 4),
  decided_by INTEGER,
  decided_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ingredient_price_reviews_line ON ingredient_price_reviews (invoice_line_id);
