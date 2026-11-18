-- Reasons to Buy (Graeme, 18 Nov 2026): the list of reasons we give
-- customers to buy ("You've got credit", "Free pack", …), which past Klaviyo
-- emails used each one (matched automatically from the subject, preview and
-- content), so the Sales & Marketing page can show what hasn't been used for
-- longest. Objective I. Safe to run twice.

CREATE TABLE IF NOT EXISTS marketing_reasons_to_buy (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  -- What counts as this reason, in plain words: the matcher reads it.
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- One row per sent campaign once it has been read against the reasons list.
-- `signature` is the list it was read against: a changed list re-reads it.
CREATE TABLE IF NOT EXISTS marketing_campaign_reasons_read (
  campaign_id TEXT PRIMARY KEY,
  signature TEXT NOT NULL,
  -- The email's words (subject, preview, body text), kept so a re-read
  -- doesn't fetch the body from Klaviyo again.
  body_text TEXT,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Which reasons a campaign used.
CREATE TABLE IF NOT EXISTS marketing_campaign_reason_matches (
  campaign_id TEXT NOT NULL,
  reason_id INTEGER NOT NULL REFERENCES marketing_reasons_to_buy(id) ON DELETE CASCADE,
  why TEXT,
  PRIMARY KEY (campaign_id, reason_id)
);
CREATE INDEX IF NOT EXISTS ix_campaign_reason_matches_reason ON marketing_campaign_reason_matches (reason_id);
