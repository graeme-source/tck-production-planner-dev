-- Migration: visitor_log — digital visitor book (HACCP)
--
-- Replaces the paper book by the door. A visitor signs in on the iPad before
-- entering: name, who they're seeing, and three declarations (illness in the
-- last 48h, loose jewellery removed, PPE agreed). signed_in_at is stamped by
-- the server so the timestamp is evidence, not self-reported.
--
-- A "yes" to the illness question still writes a row, with
-- entry_permitted = FALSE — "we asked and turned them away" is the evidence an
-- EHO wants. signed_out_at NULL = still on site (fire roll-call).
--
-- Applied idempotently at API startup (runStartupMigrations) as well.

CREATE TABLE IF NOT EXISTS visitor_log (
  id SERIAL PRIMARY KEY,
  visitor_name TEXT NOT NULL,
  company TEXT,
  visiting TEXT,
  purpose TEXT,
  illness_last_48h BOOLEAN NOT NULL,
  jewellery_removed BOOLEAN NOT NULL DEFAULT FALSE,
  ppe_agreed BOOLEAN NOT NULL DEFAULT FALSE,
  entry_permitted BOOLEAN NOT NULL DEFAULT TRUE,
  signed_in_at TIMESTAMP NOT NULL DEFAULT NOW(),
  signed_out_at TIMESTAMP,
  recorded_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  recorded_by_name TEXT,
  signed_out_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  signed_out_by_name TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_visitor_log_signed_in ON visitor_log (signed_in_at);
