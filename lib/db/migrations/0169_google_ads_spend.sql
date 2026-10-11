-- Google Ads daily spend joins the Numbers page's ad spend (Graeme,
-- 2026-10-11). Objective I (founder command centre: profit and foresight).
--
-- No Google Ads API (no developer token, no OAuth). Instead a small Google
-- Ads Script, pasted into the Google Ads account and scheduled daily, POSTs
-- the last week's spend per day to /api/ad-spend/google-ads. Each run
-- re-sends the recent days, so late-settling spend gets corrected.
--
-- ad_spend_channel_days — spend per London day per channel, for channels
-- that are NOT the original founder_ad_spend figure. founder_ad_spend stays
-- exactly as it is (the Meta channel: synced from Meta, or typed by hand on
-- the Numbers panel). A day's total ad spend is founder_ad_spend + every
-- channel row here (api-server lib/ad-spend-channels.ts).
--
--   channel      'google' (the only one so far; widen the CHECK for more)
--   source       'google_ads_script' = sent by the script
--                'manual'            = typed by a person
--                The same rule as Meta: a hand-typed figure for a
--                day + channel always wins. The script may insert a day and
--                may update a day IT wrote, never a 'manual' one — enforced
--                in the upsert's ON CONFLICT ... WHERE as well as in code.
--   account_id   the Google Ads customer id that sent it (not a secret)
--   received_at  when the script last sent this day
--
-- ad_spend_ingest_links — one row per channel: the script's connection key
-- and what it last sent, so the Numbers page can say "Last received: …".
--
--   token_hash   sha256 (hex) of the key. The key itself is shown to the
--                founder ONCE when made and never stored. NULL = turned off.
--   token_hint   its last 4 characters, so he can tell keys apart
--   last_*       the most recent accepted POST (days, span, account, and
--                the account's timezone as the script reported it)
CREATE TABLE IF NOT EXISTS ad_spend_channel_days (
  spend_date  DATE NOT NULL,
  channel     TEXT NOT NULL CHECK (channel IN ('google')),
  amount      NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
  source      TEXT NOT NULL CHECK (source IN ('google_ads_script', 'manual')),
  account_id  TEXT,
  received_at TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (spend_date, channel)
);

-- "Since when do we have Google figures?" (MIN per channel) and range reads.
CREATE INDEX IF NOT EXISTS ad_spend_channel_days_channel_date_idx
  ON ad_spend_channel_days (channel, spend_date);

CREATE TABLE IF NOT EXISTS ad_spend_ingest_links (
  channel               TEXT PRIMARY KEY CHECK (channel IN ('google')),
  token_hash            TEXT,
  token_hint            TEXT,
  token_created_at      TIMESTAMP,
  token_created_by_name TEXT,
  last_received_at      TIMESTAMP,
  last_day_count        INTEGER,
  last_from             DATE,
  last_to               DATE,
  last_account_id       TEXT,
  last_time_zone        TEXT,
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);
