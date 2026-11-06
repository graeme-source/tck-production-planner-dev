-- Paid or unpaid on an invoice waiting for its transaction (Graeme, 6 Nov 2026).
-- Blank until someone says. Objective I.
--
-- Safe to run twice.

ALTER TABLE fin_invoices ADD COLUMN IF NOT EXISTS payment_status TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fin_invoices_payment_status_check') THEN
    ALTER TABLE fin_invoices ADD CONSTRAINT fin_invoices_payment_status_check CHECK (payment_status IN ('paid', 'unpaid'));
  END IF;
END $$;
