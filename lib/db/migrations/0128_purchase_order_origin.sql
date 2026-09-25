-- Recording a delivery we weren't expecting (Graeme, 2026-09-25: "an order
-- gets automatically created by a supplier that we're not necessarily aware
-- of ... the delivery arrives, but we've got no ability to receive it through
-- the front end"). Objectives C (stock is right, so we never run out) and D
-- (every delivery gets the same goods-in checks).
--
-- origin — where the purchase order came from:
--   'planned'    raised from the Orders page / queued production (every row
--                that exists today, hence the default).
--   'unexpected' recorded at the front door because it turned up without an
--                order in the app. Labelled "Unexpected" on the deliveries
--                list so the buyer can see what arrived off-plan.
--
-- originally_expected_date — set when an open order is received on a
-- different day to the one it was booked for ("it's that order, it just came
-- early / late"). The order moves to today so it sits with today's deliveries
-- and its use-by dates are worked out from the day it really arrived; this
-- keeps the day it was booked for. NULL for orders that arrived on the day.
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'planned';

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS originally_expected_date DATE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_origin_check'
  ) THEN
    ALTER TABLE purchase_orders
      ADD CONSTRAINT purchase_orders_origin_check
      CHECK (origin IN ('planned', 'unexpected'));
  END IF;
END $$;

-- "Which open orders could this delivery be?" scans placed orders by
-- supplier; this keeps that lookup cheap as order history grows.
CREATE INDEX IF NOT EXISTS ix_purchase_orders_status_supplier
  ON purchase_orders (status, supplier_id);
