-- QuickBooks read-only connection for the finance module (Graeme,
-- 2026-08-28): posted transactions rule out card lines automatically,
-- whittling the list down to what's truly outstanding. Read-only — the
-- app never writes to QuickBooks.

CREATE TABLE IF NOT EXISTS fin_qbo_connection (
  id serial PRIMARY KEY,
  realm_id text NOT NULL,
  access_token_enc text NOT NULL,
  refresh_token_enc text NOT NULL,
  access_expires_at timestamp,
  refresh_expires_at timestamp,
  sync_cursor timestamp,
  last_sync_at timestamp,
  last_error text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fin_qbo_txns (
  id serial PRIMARY KEY,
  qbo_id text NOT NULL,
  entity_type text NOT NULL,           -- 'Purchase' | 'Bill'
  txn_date date,
  total_amt numeric(12,2),
  vendor_name text,
  doc_number text,
  synced_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (entity_type, qbo_id)
);

ALTER TABLE fin_lines
  ADD COLUMN IF NOT EXISTS qbo_txn_id integer,
  ADD COLUMN IF NOT EXISTS posted_detected_at timestamp;
