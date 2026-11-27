-- Server starts + the packer's fulfil checklist answers (Graeme, 27 Nov 2026
-- — #140447). Objective C. Safe to run twice.
-- Every time the API process starts (boot in index.ts), so the "should
-- already have been fulfilled" checklist can see that the server restarted
-- just after Complete was pressed — the crash the team can fix themselves.
CREATE TABLE IF NOT EXISTS server_starts (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deployment_id TEXT,
  replica_id TEXT
);
CREATE INDEX IF NOT EXISTS server_starts_at_idx ON server_starts (started_at DESC);

-- What the packer answered on that checklist: found the box or not, what the
-- automatic checks said, and whether it was fixed there and then.
CREATE TABLE IF NOT EXISTS fulfil_checks (
  id SERIAL PRIMARY KEY,
  shopify_order_id BIGINT NOT NULL,
  user_id INTEGER,
  user_name TEXT,
  found BOOLEAN NOT NULL,
  outcome TEXT NOT NULL,
  diagnosis JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fulfil_checks_order_idx ON fulfil_checks (shopify_order_id, created_at DESC);
