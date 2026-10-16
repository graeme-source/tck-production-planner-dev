-- Recipe production route + wrap-to-Shopify ledger (Graeme, 16 Oct 2026).
-- Objectives A (a new kind of product without code changes), C (stock is
-- right: freezer adds are real stock and reach Shopify), E/G (KPIs stay
-- honest) and F (every Shopify write is visible and safe to retry).
--
-- Cinnamon buns go dough → sheeting → building → STRAIGHT TO WRAPPING (the
-- team proofs and bakes them by hand for now), are wrapped into the freezer,
-- and every wrap tap adds the packs to the Shopify variant's stock. They are
-- not in the calzone KPIs but do use the day's capacity: "48 packs of buns ≈
-- 20 calzone batches". All of this is recipe data, read through
-- @workspace/production-schedule recipe-route.ts — no product names in code.
--
-- recipes:
--   skip_ovens                  true = no ovens step; wrapping follows the
--                               builders' confirmed batches.
--   default_storage             'fridge' | 'freezer' — where the wrapping
--                               station sends packs unless the wrapper flips it.
--   shopify_push_on_wrap        true = each freezer add at wrapping adds +N to
--                               the mapped Shopify variant (and a take-back
--                               takes them off again), via shopify_wrap_pushes.
--   exclude_from_kpis           true = left out of the calzone KPIs (building
--                               pace, team efficiency, defects, calzone batch
--                               counts in meetings / dashboard).
--   calzone_batch_equivalent    calzone batches of day capacity ONE batch of
--                               this recipe uses. NULL = 1 (every existing
--                               recipe, unchanged).
--
-- fridge_stock_changes.location: the wrapping log now records freezer adds
-- too (the wrapping pace reads every wrap), so each row says where the packs
-- went. Existing rows are all production fridge.
--
-- shopify_wrap_pushes: one row per wrap / take-back event. event_key is
-- UNIQUE and is also Shopify's idempotency key, so a double tap or a retry can
-- never add the stock twice. Status: pending → sending → sent | failed |
-- skipped (server not allowed to write to Shopify). Only 'failed' is retried.
--
-- Data: recipe 27 (Cinnamon Buns) gets the route by id — 48 buns a batch,
-- packs of 6 = 8 packs a batch; 6 batches = 48 packs ≈ 20 calzone batches,
-- so one batch = 20 / 6 = 3.333333.
--
-- Idempotent: re-running changes nothing.

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS skip_ovens BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS default_storage TEXT NOT NULL DEFAULT 'fridge';
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS shopify_push_on_wrap BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS exclude_from_kpis BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS calzone_batch_equivalent NUMERIC(10, 6);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipes_default_storage_check') THEN
    ALTER TABLE recipes ADD CONSTRAINT recipes_default_storage_check
      CHECK (default_storage IN ('fridge', 'freezer'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipes_calzone_batch_equivalent_check') THEN
    ALTER TABLE recipes ADD CONSTRAINT recipes_calzone_batch_equivalent_check
      CHECK (calzone_batch_equivalent IS NULL OR calzone_batch_equivalent >= 0);
  END IF;
END $$;

ALTER TABLE fridge_stock_changes ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT 'production_fridge';

CREATE TABLE IF NOT EXISTS shopify_wrap_pushes (
  id              SERIAL PRIMARY KEY,
  event_key       TEXT NOT NULL UNIQUE,
  kind            TEXT NOT NULL CHECK (kind IN ('wrap', 'take_back')),
  plan_id         INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  plan_item_id    INTEGER NOT NULL REFERENCES production_plan_items(id) ON DELETE CASCADE,
  recipe_id       INTEGER NOT NULL REFERENCES recipes(id) ON DELETE RESTRICT,
  variant_id      TEXT,
  location_id     TEXT,
  delta           INTEGER NOT NULL CHECK (delta <> 0),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  error           TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  quantity_after  INTEGER,
  user_id         INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  sent_at         TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_shopify_wrap_pushes_item ON shopify_wrap_pushes (plan_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shopify_wrap_pushes_status ON shopify_wrap_pushes (status) WHERE status <> 'sent';

UPDATE recipes
   SET skip_ovens = TRUE,
       default_storage = 'freezer',
       shopify_push_on_wrap = TRUE,
       exclude_from_kpis = TRUE,
       calzone_batch_equivalent = 3.333333
 WHERE id = 27;
