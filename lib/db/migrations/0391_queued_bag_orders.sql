-- 8-pack bag orders queued for a make-day that has no production plan yet
-- (Graeme, 22 Nov 2026: "exactly the same process, but it's just a queued
-- version … the 8-pack bags will definitely get added to the relevant
-- production day"). Queuing tags the Shopify order exactly like Process
-- (delivery date + production); the bags wait here and are added to the
-- plan's eight_pack_bag_count — the same field Process adds to — the moment a
-- plan for production_date exists (on plan save, and a sweep every minute).
-- An applied row whose plan is deleted (plan_id goes NULL) is re-applied to
-- the next plan for that day. Objective C. Safe to run twice.

CREATE TABLE IF NOT EXISTS queued_bag_orders (
  id SERIAL PRIMARY KEY,
  shopify_order_id BIGINT NOT NULL,
  order_name TEXT NOT NULL,
  customer_name TEXT,
  delivery_date DATE NOT NULL,
  production_date DATE NOT NULL,
  -- [{ "recipeId": n, "recipeName": "…", "bags": n }]
  lines JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'applied', 'cancelled')),
  -- Why it hasn't gone on yet (no plan / recipe not on the plan); NULL once applied.
  problem TEXT,
  plan_id INTEGER REFERENCES production_plans(id) ON DELETE SET NULL,
  applied_at TIMESTAMP,
  queued_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  queued_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMP
);
-- One live queue entry per Shopify order.
CREATE UNIQUE INDEX IF NOT EXISTS queued_bag_orders_one_live ON queued_bag_orders (shopify_order_id) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS queued_bag_orders_waiting ON queued_bag_orders (production_date) WHERE status <> 'cancelled';
