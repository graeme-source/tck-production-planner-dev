-- "Split with another supplier" on an Orders line (fix-queue #248 + #328,
-- Jane Miles; Graeme approved 22 Oct 2026). Objective C.
--
-- Jane counts blue flour once, on Monday, and orders half from Express
-- (Monday) and half from A D Maria (Tuesday). A split saves the second half
-- here, on the server — not in the browser — so it turns up on the other
-- supplier's next order day as a fixed amount, "Split from Express, Mon".
--
--   packs               supplier packs moved (the ingredient's own pack)
--   from_*              the order it was taken from: supplier, plan, day
--   target_supplier_id  the supplier it goes to
--   target_order_date   that supplier's next order day not already placed,
--                       fixed when the split is made (shown before saving)
--   status              'pending' until the target order is placed
--                       ('placed', with purchase_order_id) or someone
--                       cancels it before then ('cancelled')
--
-- Works for any ingredient; nothing here knows about flour. Surplus
-- settings are untouched — the split moves packs, it doesn't change maths.

CREATE TABLE IF NOT EXISTS order_line_splits (
  id                   SERIAL PRIMARY KEY,
  ingredient_id        INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  packs                NUMERIC(10, 2) NOT NULL CHECK (packs > 0),
  from_supplier_id     INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  from_plan_id         INTEGER REFERENCES production_plans(id) ON DELETE SET NULL,
  from_order_date      DATE NOT NULL,
  target_supplier_id   INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  target_order_date    DATE NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'placed', 'cancelled')),
  purchase_order_id    INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL,
  created_by_user_id   INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  placed_at            TIMESTAMP,
  cancelled_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  cancelled_at         TIMESTAMP,
  CHECK (target_supplier_id <> from_supplier_id)
);

CREATE INDEX IF NOT EXISTS order_line_splits_pending_idx
  ON order_line_splits (status, target_supplier_id, target_order_date);
CREATE INDEX IF NOT EXISTS order_line_splits_from_plan_idx
  ON order_line_splits (from_plan_id, from_supplier_id);
