-- Finance → Invoices: a searchable library of every invoice we hold
-- (Graeme, 3 Nov 2026): "a database of all of our invoices that we've
-- uploaded … search for by supplier, by financial year, by calendar date,
-- by period". Files arrive from zip/PDF/photo uploads, or from a card
-- transaction's attachments when it's marked done ("we want to know who's
-- posted it … and timestamp every time something happens").
--
-- Append-only like fin_documents (6-year HMRC retention): no delete route.
-- sha256 is unique, so the same file never lands twice: an upload of a
-- file already held is counted as a duplicate, and a transaction's file
-- that's already in the library gets linked to the transaction instead.
CREATE TABLE IF NOT EXISTS fin_invoice_uploads (
  id SERIAL PRIMARY KEY,
  file_name TEXT NOT NULL,
  files_found INTEGER NOT NULL DEFAULT 0,
  files_added INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  skipped JSONB NOT NULL DEFAULT '[]'::jsonb,
  uploaded_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fin_invoices (
  id SERIAL PRIMARY KEY,
  file_blob BYTEA NOT NULL,
  file_mime TEXT NOT NULL,
  file_name TEXT NOT NULL,
  -- Folder path inside the zip it came from, if any ("Aluxo/2026/INV1.pdf").
  source_path TEXT,
  file_size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  -- 'upload' (zip/PDF/photo dropped on the Invoices tab) | 'transaction'
  -- (attached to a card line when it was marked done)
  source TEXT NOT NULL,
  upload_id INTEGER REFERENCES fin_invoice_uploads(id) ON DELETE SET NULL,
  line_id INTEGER,
  document_id INTEGER,
  supplier_name TEXT,
  vendor_id INTEGER,
  invoice_date DATE,
  invoice_number TEXT,
  total_amount NUMERIC(12, 2),
  vat_amount NUMERIC(12, 2),
  currency TEXT NOT NULL DEFAULT 'GBP',
  -- 'invoice' | 'receipt' | 'credit_note' | 'statement' | 'other'
  doc_kind TEXT NOT NULL DEFAULT 'invoice',
  notes TEXT,
  -- Reading the file for supplier/date/amounts:
  -- 'pending' | 'done' | 'failed' | 'not_available' (no AI key)
  read_status TEXT NOT NULL DEFAULT 'pending',
  read_note TEXT,
  uploaded_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  -- Who marked the card transaction done (the bookkeeper who posted it).
  posted_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  posted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fin_invoices_invoice_date_idx ON fin_invoices (invoice_date);
CREATE INDEX IF NOT EXISTS fin_invoices_read_status_idx ON fin_invoices (read_status);
CREATE INDEX IF NOT EXISTS fin_invoices_line_idx ON fin_invoices (line_id);

-- Every action on finance records, with who and when: uploads, reads,
-- edits, transactions marked done or reopened, Posted ticks, chases.
CREATE TABLE IF NOT EXISTS fin_events (
  id SERIAL PRIMARY KEY,
  -- 'invoice' | 'line'
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  -- Name at the time, so history still reads right if the user goes.
  user_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fin_events_entity_idx ON fin_events (entity_type, entity_id, created_at);
