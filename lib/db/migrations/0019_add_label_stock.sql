-- Migration: Label Stock Check tool
--
-- Powers the "Label Stock Check" tool under Inventory > Tools. Tracks
-- weight-based stock checks of printed-label rolls (one per recipe) and
-- runs a water-fill rebalance to suggest order quantities that align
-- with DPT planning weights — so every label runs out at the same time.
--
-- Two tables + three app_settings rows:
--   1. label_recipes — one row per recipe that participates in the tool.
--      Real recipes pull their DPT weight from dpt_settings; miscellaneous
--      entries (recipes not yet in the system) carry an inline misc_name +
--      misc_dpt_pct override that's used by THIS tool only. Once a misc is
--      mapped to a real recipe via mapped_recipe_id, the calculator starts
--      using the real DPT weight automatically.
--   2. label_stock_checks — every stock check is persisted (audit/history
--      for usage trend analysis). The latest row per label_recipe drives
--      the calculator. Snapshots the global empty/label weights at check
--      time so the count stays stable even if the global setting changes.
--   3. app_settings entries: global empty-roll weight, global per-label
--      weight, default order quantity (30k).

CREATE TABLE IF NOT EXISTS label_recipes (
  id serial PRIMARY KEY,
  recipe_id integer REFERENCES recipes(id) ON DELETE CASCADE,
  misc_name text,
  misc_dpt_pct numeric(6,3),
  mapped_recipe_id integer REFERENCES recipes(id) ON DELETE SET NULL,
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  -- A row is either a real recipe (recipe_id set) or miscellaneous
  -- (misc_name + misc_dpt_pct set). Enforced via CHECK so the tool
  -- doesn't accidentally end up with half-filled rows.
  CONSTRAINT label_recipes_kind_check CHECK (
    (recipe_id IS NOT NULL AND misc_name IS NULL)
    OR (recipe_id IS NULL AND misc_name IS NOT NULL)
  )
);

-- One row per recipe — prevents accidentally registering the same real
-- recipe twice. Misc entries are deduplicated by name.
CREATE UNIQUE INDEX IF NOT EXISTS uq_label_recipe_real
  ON label_recipes (recipe_id) WHERE recipe_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_label_recipe_misc
  ON label_recipes (misc_name) WHERE misc_name IS NOT NULL;

CREATE TABLE IF NOT EXISTS label_stock_checks (
  id serial PRIMARY KEY,
  label_recipe_id integer NOT NULL REFERENCES label_recipes(id) ON DELETE CASCADE,
  num_rolls integer NOT NULL,
  total_weight_g numeric(12,3) NOT NULL,
  -- Snapshots of the global weights used to compute the count. Kept on
  -- the row so historical checks don't shift if you re-calibrate the
  -- empty-roll or per-label weight later.
  empty_roll_weight_g_used numeric(10,3) NOT NULL,
  label_weight_g_used numeric(10,4) NOT NULL,
  computed_count integer NOT NULL,
  user_id integer REFERENCES app_users(id) ON DELETE SET NULL,
  checked_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_label_stock_check_recipe_time
  ON label_stock_checks (label_recipe_id, checked_at DESC);

-- Seed the three global settings if they don't exist. Values are stored
-- as text in app_settings (same convention as the rest of the table) and
-- parsed as numbers in the backend.
INSERT INTO app_settings (key, value, updated_at)
  VALUES ('label_empty_roll_weight_g', '0', now())
  ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at)
  VALUES ('label_label_weight_g', '0', now())
  ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at)
  VALUES ('label_default_order_qty', '30000', now())
  ON CONFLICT (key) DO NOTHING;
