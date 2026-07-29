-- Migration: case orders — bulk frozen 8-pack-bag orders produced over days
--
-- Vocabulary: portion (1 calzone) · bag (8 portions, frozen for the customer,
-- NOT normal fridge 8-pack stock) · case (a box of bags; composition is data —
-- "Margherita case" = 3× margherita, "Mixed case" = 1× each of three) ·
-- batch (10 portions).
--
-- Also:
--   recipes.max_batches_per_day  — per-recipe process ceiling (BBQ pork: 30);
--                                  warn-and-allow, never hard-block
--   production_plan_items        — freezer_eight_pack_bag_count ("of which
--                                  freezer") within eight_pack_bag_count, its
--                                  progress twin freezer_eight_pack_qty, and
--                                  case_order_id linking the day's freezer bags
--                                  to their order
--   app_settings                 — capacity defaults: 110 batches/day with a
--                                  Dough Prep person on shift, 80 without
--
-- Applied idempotently at API startup (runStartupMigrations) as well.

CREATE TABLE IF NOT EXISTS case_types (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS case_type_lines (
  id SERIAL PRIMARY KEY,
  case_type_id INTEGER NOT NULL REFERENCES case_types(id) ON DELETE CASCADE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE RESTRICT,
  bags_per_case INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_case_type_lines_type ON case_type_lines (case_type_id);

CREATE TABLE IF NOT EXISTS case_orders (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  reference TEXT,
  target_collection_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_case_orders_target ON case_orders (target_collection_date);

CREATE TABLE IF NOT EXISTS case_order_lines (
  id SERIAL PRIMARY KEY,
  case_order_id INTEGER NOT NULL REFERENCES case_orders(id) ON DELETE CASCADE,
  case_type_id INTEGER NOT NULL REFERENCES case_types(id) ON DELETE RESTRICT,
  cases_ordered INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_case_order_lines_order ON case_order_lines (case_order_id);

CREATE TABLE IF NOT EXISTS case_order_production (
  id SERIAL PRIMARY KEY,
  case_order_id INTEGER NOT NULL REFERENCES case_orders(id) ON DELETE CASCADE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE RESTRICT,
  plan_id INTEGER REFERENCES production_plans(id) ON DELETE SET NULL,
  production_date DATE NOT NULL,
  bags INTEGER NOT NULL,
  counted_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  counted_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_case_order_production_order ON case_order_production (case_order_id, recipe_id);

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS max_batches_per_day INTEGER;

ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS freezer_eight_pack_bag_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS freezer_eight_pack_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS case_order_id INTEGER REFERENCES case_orders(id) ON DELETE SET NULL;

-- Capacity defaults (confirmed 2026-07-28). The Planday position that unlocks
-- the higher ceiling is "Dough Prep"; the setting stores a position-name match.
INSERT INTO app_settings (key, value, updated_at) VALUES ('capacity_batches_with_dough_prep', '110', NOW()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('capacity_batches_without_dough_prep', '80', NOW()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('capacity_dough_prep_position_name', 'Dough Prep', NOW()) ON CONFLICT (key) DO NOTHING;
