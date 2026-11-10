-- Supplier payment terms + the other names their invoices come in under
-- (Graeme, 10 Nov 2026). Objective I.
--   suppliers.payment_terms   'paid_when_ordered' (card, the usual) or
--                             'on_account' (they invoice; the team pays on
--                             terms). How many days comes later.
--   supplier_invoice_names    e.g. "Northamptonshire Food Services Ltd" is
--                             NFS Meats, so the Finance Inbox can say which
--                             supplier an invoice is and how it's paid.
-- Safe to run twice.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_terms TEXT NOT NULL DEFAULT 'paid_when_ordered';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_payment_terms_check') THEN
    ALTER TABLE suppliers ADD CONSTRAINT suppliers_payment_terms_check CHECK (payment_terms IN ('paid_when_ordered', 'on_account'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS supplier_invoice_names (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_names_unique ON supplier_invoice_names (supplier_id, lower(name));

-- Graeme's list: these are all paid on account. Matched by id AND name so a
-- database where the ids differ changes nothing.
UPDATE suppliers SET payment_terms = 'on_account'
 WHERE (id, trim(name)) IN (
   (1, 'Brakes Food Service'), (26, 'NFS Meats'), (27, 'Macfarlane Packaging'),
   (31, 'Puffin Packaging'), (5, 'AB Fruits'), (43, 'APC'),
   (3, 'The Best Butcher'), (36, 'Panibois')
 );

-- The invoice names already in the library that don't contain the
-- supplier's own name.
INSERT INTO supplier_invoice_names (supplier_id, name)
SELECT s.id, v.name
  FROM (VALUES
    (26, 'NFS Meats', 'Northamptonshire Food Services Ltd'),
    (1, 'Brakes Food Service', 'Sysco GB Ltd (Brakes)'),
    (27, 'Macfarlane Packaging', 'Macfarlane Group UK Limited')
  ) AS v(supplier_id, supplier_name, name)
  JOIN suppliers s ON s.id = v.supplier_id AND trim(s.name) = v.supplier_name
ON CONFLICT DO NOTHING;
