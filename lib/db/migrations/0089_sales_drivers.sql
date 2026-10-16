-- Sales drivers (Graeme, 2026-10-16): a record of what changed on the
-- website and around it, plus the daily facts that plausibly move sales,
-- so a bad week can be read against what was going on rather than guessed.
-- Objective I (founder command centre — recommendations traceable to the
-- numbers behind them).
--
-- site_changes: one row per change. effective_at is when it went live (not
-- when it was logged). source says where the row came from — 'manual' for
-- quick-add entries, 'theme' for the GitHub-connected Shopify theme,
-- 'klaviyo' for emails sent, 'shopify' for the daily store check.
-- source_ref de-duplicates automatic imports (commit sha, campaign id…).
CREATE TABLE IF NOT EXISTS site_changes (
  id SERIAL PRIMARY KEY,
  effective_at TIMESTAMPTZ NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL,
  detail TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS site_changes_source_ref_idx
  ON site_changes (source, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_changes_effective_idx ON site_changes (effective_at);

-- delivery_availability_daily: what a customer could get on that day, not
-- what they chose. 'zapiet_1pm' rows are the 1pm check against Zapiet's own
-- calendar (an hour before the 2pm next-day cutoff) and are exact.
-- 'orders_estimate' rows are back-filled from the shortest wait any
-- customer actually booked that morning — an estimate, flagged as such, and
-- never allowed to overwrite a 1pm check.
CREATE TABLE IF NOT EXISTS delivery_availability_daily (
  day DATE PRIMARY KEY,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  earliest_date DATE,
  lead_days INTEGER,
  next_day_available BOOLEAN,
  source TEXT NOT NULL,
  sample_orders INTEGER,
  note TEXT
);

-- store_daily_metrics: Shopify online-store sessions and conversion rate
-- per London day (ShopifyQL), alongside order counts from the orders cache.
-- Kept so history survives and the analysis never re-queries a year live.
CREATE TABLE IF NOT EXISTS store_daily_metrics (
  day DATE PRIMARY KEY,
  sessions INTEGER,
  conversion_rate NUMERIC(8,4),
  orders INTEGER,
  new_customer_orders INTEGER,
  revenue NUMERIC(12,2),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
