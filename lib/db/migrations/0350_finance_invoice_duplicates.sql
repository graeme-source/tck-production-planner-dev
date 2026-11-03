-- Finance → Invoices: the same invoice twice (Graeme, 3 Nov 2026: "make sure
-- we can't double-upload the same invoice"). An identical file is already
-- refused (sha256 unique). This catches the same invoice as a DIFFERENT
-- file — a re-scan, a re-saved PDF, the copy from the email and the copy
-- from the portal: once read, an invoice with the same supplier + invoice
-- number (or, with no number, same supplier + date + total) as an earlier
-- one points at it here and is hidden from the library by default.
-- not_duplicate = someone checked and said it isn't one.
ALTER TABLE fin_invoices ADD COLUMN IF NOT EXISTS duplicate_of_id INTEGER;
ALTER TABLE fin_invoices ADD COLUMN IF NOT EXISTS not_duplicate BOOLEAN NOT NULL DEFAULT FALSE;
-- The comparison key (invoiceDuplicateKey), kept on the row so the check
-- is one indexed lookup.
ALTER TABLE fin_invoices ADD COLUMN IF NOT EXISTS dup_key TEXT;
CREATE INDEX IF NOT EXISTS fin_invoices_dup_key_idx ON fin_invoices (dup_key);
CREATE INDEX IF NOT EXISTS fin_invoices_duplicate_idx ON fin_invoices (duplicate_of_id);
-- Upload batches now arrive in parts from the browser; 'open' until the
-- browser says it has sent everything.
ALTER TABLE fin_invoice_uploads ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'done';
