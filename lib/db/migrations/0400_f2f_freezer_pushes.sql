-- Freezer moves → the recipe's F2F product's stock in Shopify (Graeme,
-- 25 Nov 2026). Wherever packs go into the freezer — the wrapping station's
-- Product Freezer, the Wonky Rack transfer, the closing fridge check — the
-- packs are also added (+N) to the recipe's F2F variant's on-hand in Shopify.
-- Switched OFF (app_settings feature_f2f_freezer_shopify_push) until every
-- core recipe has an F2F product linked.
--
-- One row per move per recipe. event_key is UNIQUE and is also Shopify's
-- idempotency key, so a double tap or a retry can never add the packs twice.
-- The app's own stock move is never undone by a Shopify problem: the row
-- records the failure and managers get a Retry button.
--
--   source       'wrap_freezer' | 'wonky' | 'closing_check'
--   status       pending → sending → sent | failed | skipped
--   skip_reason  'writes_off' (this server may not write to Shopify) |
--                'untracked'  (Shopify isn't tracking stock for the variant)
--   note         extra words for the screen (e.g. sent, but not tracked)
--
-- Rules: api-server lib/f2f-freezer-push-rules.ts; writes: lib/f2f-freezer-push.ts.
-- Objective C. Safe to run twice.

CREATE TABLE IF NOT EXISTS f2f_freezer_pushes (
  id              SERIAL PRIMARY KEY,
  event_key       TEXT NOT NULL UNIQUE,
  source          TEXT NOT NULL CHECK (source IN ('wrap_freezer', 'wonky', 'closing_check')),
  recipe_id       INTEGER NOT NULL REFERENCES recipes(id) ON DELETE RESTRICT,
  plan_id         INTEGER REFERENCES production_plans(id) ON DELETE SET NULL,
  plan_item_id    INTEGER REFERENCES production_plan_items(id) ON DELETE SET NULL,
  variant_id      TEXT,
  product_title   TEXT,
  variant_title   TEXT,
  location_id     TEXT,
  delta           INTEGER NOT NULL CHECK (delta <> 0),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  skip_reason     TEXT,
  error           TEXT,
  note            TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  quantity_after  INTEGER,
  user_id         INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  user_name       TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  sent_at         TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_f2f_freezer_pushes_status ON f2f_freezer_pushes (status, created_at DESC) WHERE status <> 'sent';
CREATE INDEX IF NOT EXISTS idx_f2f_freezer_pushes_item ON f2f_freezer_pushes (plan_item_id) WHERE plan_item_id IS NOT NULL;
