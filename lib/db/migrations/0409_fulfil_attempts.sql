-- Fulfil attempts (Graeme, 27 Nov 2026 — #140447): one row every time the
-- packing screen asks the server to fulfil an order, written BEFORE Shopify
-- is called and finished when the answer goes back. A row left at 'started'
-- means the server stopped mid-way; 'failed'/'refused' carry the reason.
-- An order still on the pack list with any row here "should already have
-- been fulfilled" and is flagged when it is opened. Objective C.
-- Safe to run twice.
CREATE TABLE IF NOT EXISTS fulfil_attempts (
  id SERIAL PRIMARY KEY,
  shopify_order_id BIGINT NOT NULL,
  route TEXT NOT NULL,
  consignment_number TEXT,
  client_attempt_id TEXT,
  try_number INTEGER,
  user_id INTEGER,
  user_name TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  outcome TEXT NOT NULL DEFAULT 'started',
  http_status INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS fulfil_attempts_order_idx ON fulfil_attempts (shopify_order_id, started_at DESC);
