-- Minimum shelf life at goods-in, reported to the supplier (Graeme,
-- 2026-10-16). Objective D (goods-in checks every time), and C (stock
-- stays right — short-dated stock is caught at the door).
--
-- "Brakes promise at least 3 days' shelf life on the diced chicken, but it
-- often arrives with 1 day." This morning 20 kg arrived going out of date
-- tomorrow and had to be frozen.
--
--   ingredients.min_delivery_shelf_life_days   NULL = no minimum. When set,
--       goods-in warns on a use-by date fewer than this many whole days
--       after the delivery day, and the receiver accepts or rejects it.
--   suppliers.account_manager_name / account_manager_email
--       the supplier's account manager — shown on the supplier record and in
--       the Contacts directory; the shelf-life report is emailed here.
--       Set per supplier in the app, never in a migration.
--   delivery_shelf_life_reports
--       one row per PO line that arrived short-dated: the decision (who,
--       when, use-by, days vs minimum, accepted/rejected) and the email to
--       the supplier (sent / failed + error / no_address / skipped). The
--       UNIQUE line id makes it idempotent: a re-save never re-sends.
--
-- Idempotent: re-running changes nothing.

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS min_delivery_shelf_life_days INTEGER;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS account_manager_name TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS account_manager_email TEXT;

CREATE TABLE IF NOT EXISTS delivery_shelf_life_reports (
  id                       SERIAL PRIMARY KEY,
  purchase_order_id        INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  purchase_order_line_id   INTEGER NOT NULL UNIQUE REFERENCES purchase_order_lines(id) ON DELETE CASCADE,
  supplier_id              INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  ingredient_id            INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
  ingredient_name          TEXT NOT NULL,
  quantity                 NUMERIC(12, 4),
  unit                     TEXT,
  delivery_date            DATE NOT NULL,
  use_by_date              DATE NOT NULL,
  shelf_life_days          INTEGER NOT NULL,
  min_shelf_life_days      INTEGER NOT NULL,
  -- 'accepted' (kept — used or frozen) | 'rejected' (not received)
  decision                 TEXT NOT NULL,
  decided_by_id            INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  decided_by_name          TEXT,
  decided_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  -- 'pending' | 'sent' | 'failed' | 'no_address' | 'skipped'
  email_status             TEXT NOT NULL DEFAULT 'pending',
  email_error              TEXT,
  emailed_to_name          TEXT,
  emailed_to               TEXT,
  emailed_at               TIMESTAMP
);

CREATE INDEX IF NOT EXISTS delivery_shelf_life_reports_po_idx
  ON delivery_shelf_life_reports (purchase_order_id);
