-- Stock-gate holds: products automatically held back from next-day delivery
-- when the fridge-vs-despatch surplus falls to the configured threshold.
-- The hold is a Shopify product tag; a Zapiet product-specific
-- preparation-time rule keyed to that tag removes tomorrow from the
-- delivery-date picker. Rows are never deleted — released_at stamps the
-- release, so the table is also the audit trail.
--
-- Applied at boot by runStartupMigrations() in
-- artifacts/api-server/src/index.ts (idempotent CREATE TABLE IF NOT
-- EXISTS); this file is the reference copy.

CREATE TABLE IF NOT EXISTS stock_gate_holds (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  recipe_name TEXT NOT NULL,
  tag TEXT NOT NULL,
  product_gid TEXT,
  product_title TEXT,
  shopify_variant_id TEXT,
  surplus_at_hold INTEGER NOT NULL,
  threshold_at_hold INTEGER NOT NULL,
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  verify_status TEXT,
  verify_note TEXT,
  held_at TIMESTAMP NOT NULL DEFAULT NOW(),
  released_at TIMESTAMP,
  released_by TEXT,
  surplus_at_release INTEGER
);

CREATE INDEX IF NOT EXISTS ix_stock_gate_holds_recipe ON stock_gate_holds (recipe_id);
CREATE INDEX IF NOT EXISTS ix_stock_gate_holds_held_at ON stock_gate_holds (held_at);
-- One live hold per recipe.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_gate_holds_active ON stock_gate_holds (recipe_id) WHERE released_at IS NULL;

-- Default settings (all read live each poller cycle).
INSERT INTO app_settings (key, value, updated_at) VALUES
  ('stock_gate_enabled', 'false', NOW()),
  ('stock_gate_dry_run', 'true', NOW()),
  ('stock_gate_threshold_packs', '5', NOW()),
  ('stock_gate_release_packs', '10', NOW()),
  ('stock_gate_auto_release', 'true', NOW()),
  ('stock_gate_tag', 'low-stock-hold', NOW()),
  ('stock_gate_interval_minutes', '5', NOW()),
  ('stock_gate_zapiet_location_id', '270812', NOW())
ON CONFLICT (key) DO NOTHING;
