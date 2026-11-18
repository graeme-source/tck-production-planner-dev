-- A saved copy of every SENT Klaviyo email campaign (Graeme, 18 Nov 2026:
-- "we're just looking ... if anything's changed since the last email").
-- Reasons to Buy needs the last year's sent campaigns; asking Klaviyo for a
-- year of them took ~29 s, every time its 3-minute cache ran out. Now the
-- year comes from here and Klaviyo is only asked for the last few days,
-- in the background. Klaviyo stays the master — this is a copy of what
-- was sent, nothing here is written back. Objective I. Safe to run twice.

CREATE TABLE IF NOT EXISTS klaviyo_sent_campaigns (
  campaign_id TEXT PRIMARY KEY,
  -- London day it sent (YYYY-MM-DD).
  send_day TEXT NOT NULL,
  send_at TIMESTAMPTZ,
  name TEXT NOT NULL,
  subject TEXT,
  preview_text TEXT,
  klaviyo_url TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS klaviyo_sent_campaigns_day_idx ON klaviyo_sent_campaigns (send_day);
