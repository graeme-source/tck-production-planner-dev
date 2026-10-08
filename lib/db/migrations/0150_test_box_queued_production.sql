-- Test boxes queue their own production from sales (Graeme, 2026-10-08).
-- Objectives A (a trial recipe goes from orders to the plan without anyone
-- re-typing numbers) and C (make what was sold, never forget a batch).
--
-- When a delivery's orders are closed, the app counts the box's SOLD packs
-- for that delivery date (Shopify orders mirror, net of refunds and
-- cancellations), turns them into batches (rounded up, optionally +1 safety
-- batch per recipe) and writes them to Queued production for the
-- delivery's production day — where the plan calculator already picks
-- queued batches up when that day's plan is created. Rules:
-- api-server/src/lib/test-box-production.ts (pure, tested).
--
--   queued_production.test_box_delivery_id   which delivery a queued row
--       came from, so re-counting UPDATES the box's own rows instead of
--       adding more, and reopening the delivery can take exactly them off
--       (status 'cancelled', the queue's own soft delete). NULL = queued by
--       hand on the Queued production page, as before.
--   test_box_deliveries.safety_batch   the "+1 safety batch per recipe"
--       toggle on the delivery card (default off).
--   test_box_deliveries.queued_at / queued_by_name / queued_summary   when
--       and by whom the production was last queued, and what it was
--       ("[{recipeId, name, packs, batches}]") so the card can show it and
--       say when the sales have moved since.

ALTER TABLE queued_production ADD COLUMN IF NOT EXISTS test_box_delivery_id INTEGER
  REFERENCES test_box_deliveries(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_queued_production_test_box_delivery
  ON queued_production (test_box_delivery_id) WHERE test_box_delivery_id IS NOT NULL;

ALTER TABLE test_box_deliveries ADD COLUMN IF NOT EXISTS safety_batch BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE test_box_deliveries ADD COLUMN IF NOT EXISTS queued_at TIMESTAMP;
ALTER TABLE test_box_deliveries ADD COLUMN IF NOT EXISTS queued_by_name TEXT;
ALTER TABLE test_box_deliveries ADD COLUMN IF NOT EXISTS queued_summary JSONB;
