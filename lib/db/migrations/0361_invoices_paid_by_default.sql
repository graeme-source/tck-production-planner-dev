-- An invoice counts as paid unless someone says it needs paying (Graeme,
-- 6 Nov 2026): most are already paid when they're dropped in. Objective I.
--
-- Safe to run twice.

ALTER TABLE fin_invoices ALTER COLUMN payment_status SET DEFAULT 'paid';

UPDATE fin_invoices SET payment_status = 'paid'
 WHERE payment_status IS NULL AND awaiting_transaction_at IS NOT NULL;
