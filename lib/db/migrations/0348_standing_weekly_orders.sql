-- Standing weekly orders (Fix queue #348, Graeme 3 Nov 2026): "add items to
-- come up in a fixed quantity on a certain day of the week … You can't
-- forget it if it automatically gets added to the AB Fruits order every
-- Friday." Objective C.
--
-- On the ingredient's kanban settings: the ISO weekdays (1 = Mon … 7 = Sun)
-- it's ordered on, and the fixed number of supplier packs. NULL / empty
-- weekdays or no packs = off. On a chosen day /orders/calculate puts it on
-- its supplier's card ("Every Fri"), whatever the stock.
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS standing_order_weekdays INTEGER[];
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS standing_order_packs INTEGER;

-- What happened to a standing order on a given (London) day, so it doesn't
-- come back once dealt with: 'ordered' (on a placed purchase order that
-- day — po_id set) or 'skipped' ("Not today" on the Orders page). No row =
-- still to order (only matters on a chosen weekday).
CREATE TABLE IF NOT EXISTS standing_order_marks (
  order_date DATE NOT NULL,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  mark TEXT NOT NULL CHECK (mark IN ('ordered', 'skipped')),
  po_id INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL,
  marked_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  marked_by_name TEXT,
  marked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (order_date, ingredient_id)
);
