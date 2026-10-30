-- Queued test production: the ingredient order list you come back to
-- (Graeme, 30 Oct 2026: "an order list of all of these special ingredients
-- that we can return to over the next 3 or 4 days to tick off when we've
-- ordered things… even if we navigate away from the screen and go back to
-- it. That's a problem we've had in the past."). Objective B.
--
-- One row per production day and ingredient once someone says what happened
-- to it: 'ordered' (ticked, or ordered through the queue's Create orders —
-- po_id set) or 'not_needed' (on the shelf). No row = still to order.
-- The quantity needed is never stored; it's worked out from the queued
-- batches every time, so changing a batch number changes it.

CREATE TABLE IF NOT EXISTS queued_ingredient_marks (
  production_date DATE NOT NULL,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  mark TEXT NOT NULL CHECK (mark IN ('ordered', 'not_needed')),
  po_id INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL,
  marked_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  marked_by_name TEXT,
  marked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (production_date, ingredient_id)
);
