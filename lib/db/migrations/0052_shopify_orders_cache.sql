-- Local mirror of Shopify orders + incremental-sync state, so order-heavy
-- pages (founder Numbers, P&L, surveys audience) read Postgres instead of
-- re-crawling the Shopify API on every load.
CREATE TABLE IF NOT EXISTS shopify_orders_cache (
  id BIGINT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_shopify_orders_cache_created ON shopify_orders_cache (created_at);

CREATE TABLE IF NOT EXISTS shopify_orders_sync (
  id INTEGER PRIMARY KEY,
  last_synced_at TIMESTAMPTZ,
  coverage_start DATE
);
