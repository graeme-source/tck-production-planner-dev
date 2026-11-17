-- Finance Inbox = every invoice uploaded but not yet posted (Graeme, 17 Nov
-- 2026: "all of the invoices that haven't yet been posted but have been
-- uploaded"). Uploads to the library used to skip the Inbox, so the ones
-- added since the history import of 3–4 Nov join it now. Zip contents are
-- history and stay out. Objective I. Safe to run twice.

UPDATE fin_invoices
   SET awaiting_transaction_at = created_at, updated_at = NOW()
 WHERE source = 'upload'
   AND created_at >= '2026-11-05'
   AND posted_at IS NULL
   AND line_id IS NULL
   AND duplicate_of_id IS NULL
   AND awaiting_transaction_at IS NULL
   AND coalesce(source_path, '') !~* '\.zip/';
