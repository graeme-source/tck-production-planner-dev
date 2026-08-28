-- Finance / VAT invoice reconciliation MVP (docs/vat-reconciliation/PLAN.md).
-- Replaces the manual "Outstanding Transactions" Google Sheet: card-statement
-- lines, mailbox-found documents, supplier knowledge base, bookkeeper access.
-- No QuickBooks in this phase (decision: Graeme, 27 Aug 2026).

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS is_bookkeeper boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS fin_vendors (
  id serial PRIMARY KEY,
  name text NOT NULL,
  normalised_name text NOT NULL UNIQUE,
  website text,
  accounts_email text,
  phone text,
  contact_name text,
  portal_url text,
  invoice_behaviour text NOT NULL DEFAULT 'unknown',
  vat_expectation text NOT NULL DEFAULT 'unknown',
  notes text,
  details_confirmed boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fin_statement_uploads (
  id serial PRIMARY KEY,
  source text NOT NULL,
  file_name text,
  row_count integer NOT NULL DEFAULT 0,
  new_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  uploaded_by integer,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fin_lines (
  id serial PRIMARY KEY,
  upload_id integer,
  source text NOT NULL,
  line_date date NOT NULL,
  auth_date date,
  descriptor text NOT NULL,
  merchant text,
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'GBP',
  original_amount numeric(12,2),
  original_currency text,
  card_last4 text,
  cardholder text,
  vendor_id integer,
  status text NOT NULL DEFAULT 'open',
  status_note text,
  done_at timestamp,
  done_by integer,
  dedupe_hash text NOT NULL UNIQUE,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fin_lines_status_idx ON fin_lines (status);
CREATE INDEX IF NOT EXISTS fin_lines_vendor_idx ON fin_lines (vendor_id);

CREATE TABLE IF NOT EXISTS fin_documents (
  id serial PRIMARY KEY,
  line_id integer NOT NULL,
  file_blob bytea NOT NULL,
  file_mime text NOT NULL,
  file_name text NOT NULL,
  file_size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  doc_source text NOT NULL,
  source_ref text,
  doc_kind text NOT NULL DEFAULT 'other',
  uploaded_by integer,
  superseded_by integer,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fin_documents_line_idx ON fin_documents (line_id);

CREATE TABLE IF NOT EXISTS fin_email_index (
  id serial PRIMARY KEY,
  folder text NOT NULL,
  imap_uid integer NOT NULL,
  message_id_hdr text,
  from_address text,
  from_domain text,
  subject text,
  internal_date timestamp,
  has_pdf boolean NOT NULL DEFAULT false,
  amounts_found jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (folder, imap_uid)
);

CREATE INDEX IF NOT EXISTS fin_email_index_date_idx ON fin_email_index (internal_date);

CREATE TABLE IF NOT EXISTS fin_matches (
  id serial PRIMARY KEY,
  line_id integer NOT NULL,
  email_index_id integer NOT NULL,
  score integer NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  state text NOT NULL DEFAULT 'suggested',
  decided_by integer,
  decided_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (line_id, email_index_id)
);

CREATE TABLE IF NOT EXISTS fin_mailbox (
  id serial PRIMARY KEY,
  email_address text NOT NULL,
  imap_host text NOT NULL DEFAULT 'imap.one.com',
  password_enc text NOT NULL,
  folders_watched jsonb NOT NULL DEFAULT '["INBOX"]'::jsonb,
  uid_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  scan_since date,
  last_sync_at timestamp,
  last_error text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
