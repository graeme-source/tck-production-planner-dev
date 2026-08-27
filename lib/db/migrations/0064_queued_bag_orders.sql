-- Eight-pack bag orders queued for a production date whose plan doesn't
-- exist yet.
--
-- An 8-pack order for a delivery three weeks out couldn't be processed at
-- all: processing needs a plan to put the bags on, and plans are made a
-- couple of days ahead. The order sat unprocessed in the dashboard queue for
-- a fortnight (Graeme, 2026-08-27). A row here is the promise in between —
-- the Shopify order is tagged immediately (which is what routes despatch),
-- and the bags land on the plan for that date the moment it is created.
--
-- Mirrors queued_production on purpose: same statuses, same land-on-create,
-- same reset when the plan is deleted.

CREATE TABLE IF NOT EXISTS queued_bag_orders (
  id                 SERIAL PRIMARY KEY,
  production_date    DATE NOT NULL,
  delivery_date      DATE NOT NULL,
  recipe_id          INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  bags               INTEGER NOT NULL,
  shopify_order_id   TEXT NOT NULL,
  shopify_order_name TEXT,
  status             TEXT NOT NULL DEFAULT 'queued',
  plan_id            INTEGER REFERENCES production_plans(id) ON DELETE SET NULL,
  landed_at          TIMESTAMP,
  notes              TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_queued_bag_orders_date ON queued_bag_orders (production_date);
CREATE INDEX IF NOT EXISTS ix_queued_bag_orders_status ON queued_bag_orders (status);

-- Processing the same order twice must not double the bags. The Shopify
-- "production" tag already guards against it; this makes it structural.
DO $$
BEGIN
  ALTER TABLE queued_bag_orders
    ADD CONSTRAINT uq_queued_bag_orders_order_recipe
    UNIQUE (shopify_order_id, recipe_id, production_date);
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;
