-- Test boxes, round 2 (Graeme, 2026-10-02). Objectives A (a new recipe from
-- idea to customers without surprises), C (ingredients ordered in time for
-- every delivery) and I (the whole run-up on the founder's calendar).
--
-- What changed in how a box works:
--   * No fixed selling window. A box has a LAUNCH DATE — always the VIP
--     Calzoney Club launch, its first sale — and an optional PUBLIC LAUNCH
--     date that only exists if someone adds it.
--   * A box has one or MORE DELIVERY DATES, added over time
--     (test_box_deliveries). Each one gets its own back-scheduled chain
--     (orders close, supplier order-by, ingredients in, prep, production,
--     despatch, delivery) computed on read by lib/test-box-schedule.ts.
--   * Orders for a delivery close BY HAND ("Close orders for 16 Oct"); the
--     app only works out the latest day they can close (earliest
--     specialist-ingredient order-by, or production minus orders_close_days).
--   * A one-off LAUNCH CHECKLIST (Shopify, discount, Zapiet, emails, social),
--     template in lib/test-box-launch-checklist.ts.
--   * Every checklist item is also a real to-do on the box OWNER's list.
--     test_box_tasks is the link: one row per (box, task key) holding the
--     tick (the source of truth) and the id of the to-do that shows it.
--
-- Old columns kept, no longer read or written by the app:
--   test_boxes.delivery_date  (now nullable — the dates live in
--                              test_box_deliveries; copied across below)
--   test_boxes.selling_days, vip_head_start_days, audience
-- They are left in place (not dropped) so this migration can't lose data and
-- an older build still starts; a later clean-up migration can drop them.

-- ── The box: launch, public launch, owner, and its launch marketing rows ──
ALTER TABLE test_boxes ADD COLUMN IF NOT EXISTS launch_date DATE;
ALTER TABLE test_boxes ADD COLUMN IF NOT EXISTS public_launch_date DATE;
ALTER TABLE test_boxes ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL;
-- The ONE planned VIP launch email and the ONE social-post note the box puts
-- on the marketing calendar — remembered so a re-save never duplicates them.
ALTER TABLE test_boxes ADD COLUMN IF NOT EXISTS launch_email_id INTEGER REFERENCES marketing_emails(id) ON DELETE SET NULL;
ALTER TABLE test_boxes ADD COLUMN IF NOT EXISTS social_note_event_id INTEGER REFERENCES marketing_events(id) ON DELETE SET NULL;

-- Existing boxes: launch = the old "start selling" day, worked out the way
-- the old scheduler did it: production is the 2nd working day (Mon–Fri)
-- before delivery, orders closed orders_close_days working days before
-- that, and selling started selling_days calendar days before orders closed.
UPDATE test_boxes b SET launch_date = sub.orders_close - b.selling_days
FROM (
  SELECT tb.id,
    (SELECT d::date FROM generate_series(tb.delivery_date - 1, tb.delivery_date - 120, INTERVAL '-1 day') d
      WHERE EXTRACT(ISODOW FROM d) < 6
      ORDER BY d DESC OFFSET (1 + tb.orders_close_days) LIMIT 1) AS orders_close
  FROM test_boxes tb
  WHERE tb.delivery_date IS NOT NULL
) sub
WHERE sub.id = b.id AND b.launch_date IS NULL;
UPDATE test_boxes SET launch_date = COALESCE(launch_date, delivery_date, created_at::date) WHERE launch_date IS NULL;
ALTER TABLE test_boxes ALTER COLUMN launch_date SET NOT NULL;

-- A box that was "VIPs first, then everyone" had a public launch too.
UPDATE test_boxes SET public_launch_date = launch_date + vip_head_start_days
WHERE audience = 'vip_then_public' AND public_launch_date IS NULL;

UPDATE test_boxes SET owner_id = created_by_id WHERE owner_id IS NULL;

ALTER TABLE test_boxes ALTER COLUMN delivery_date DROP NOT NULL;

-- ── Delivery dates ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_box_deliveries (
  id SERIAL PRIMARY KEY,
  test_box_id INTEGER NOT NULL REFERENCES test_boxes(id) ON DELETE CASCADE,
  delivery_date DATE NOT NULL,
  -- Boxes expected for THIS delivery (optional) — drives packs to make.
  expected_boxes INTEGER CHECK (expected_boxes IS NULL OR expected_boxes BETWEEN 0 AND 100000),
  -- Open (selling) → Closed (orders closed by hand) → Production queued →
  -- Made → Delivered; or Cancelled. Orders close MANUALLY — the app works
  -- out the latest day they can close, a person closes them.
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'queued', 'made', 'delivered', 'cancelled')),
  closed_at TIMESTAMP,
  closed_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  closed_by_name TEXT,
  -- The manual choice for its production day: test batches only, or test
  -- plus normal production. NULL = not decided yet.
  production_mix TEXT CHECK (production_mix IS NULL OR production_mix IN ('test_only', 'test_plus_normal')),
  created_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  updated_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  deleted_by_name TEXT
);
CREATE INDEX IF NOT EXISTS ix_test_box_deliveries_box ON test_box_deliveries (test_box_id) WHERE deleted_at IS NULL;
-- One live row per box per day.
CREATE UNIQUE INDEX IF NOT EXISTS ux_test_box_deliveries_day ON test_box_deliveries (test_box_id, delivery_date) WHERE deleted_at IS NULL;

-- Each existing box's single delivery date becomes its first delivery.
INSERT INTO test_box_deliveries (test_box_id, delivery_date, expected_boxes, status,
  created_by_id, created_by_name, updated_by_id, updated_by_name, created_at, updated_at, deleted_at)
SELECT b.id, b.delivery_date, b.expected_boxes,
  CASE b.status WHEN 'delivered' THEN 'delivered' WHEN 'cancelled' THEN 'cancelled'
    WHEN 'producing' THEN 'queued' WHEN 'ordering' THEN 'closed' ELSE 'open' END,
  b.created_by_id, b.created_by_name, b.updated_by_id, b.updated_by_name, b.created_at, b.updated_at, b.deleted_at
FROM test_boxes b
WHERE b.delivery_date IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM test_box_deliveries d WHERE d.test_box_id = b.id);

-- ── Ticks ↔ to-dos ─────────────────────────────────────────────────────────
-- The to-do that shows this task on the owner's list. If someone deletes the
-- to-do, the link clears and the tick (done/not done) is kept here.
ALTER TABLE test_box_tasks ADD COLUMN IF NOT EXISTS todo_task_id INTEGER REFERENCES todo_tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_test_box_tasks_todo ON test_box_tasks (todo_task_id) WHERE todo_task_id IS NOT NULL;

-- Old per-box task keys ("orders-close", "order-supplier-3") belonged to the
-- box's one delivery: re-key them to that delivery ("d12:orders-close") so
-- ticks already made carry over. The old "sell-start"/"public-launch" ticks
-- have no equivalent in the new checklist and are left as they are.
UPDATE test_box_tasks t SET task_key = 'd' || d.id || ':' || t.task_key
FROM test_box_deliveries d
WHERE d.test_box_id = t.test_box_id
  AND t.task_key NOT LIKE '%:%'
  AND t.task_key NOT IN ('sell-start', 'public-launch');
