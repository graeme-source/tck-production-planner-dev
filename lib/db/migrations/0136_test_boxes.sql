-- Test-box scheduling tool, Phase 1 (Graeme; memory project_test_box_tool,
-- built 2026-09-29). A test box is 2–4 recipes sent to customers as a trial
-- for one delivery day. From that delivery day the tool works BACKWARDS to
-- every deadline — start selling, orders close, order each supplier's
-- ingredients, prep/dough, production, despatch — with a bigger safety
-- buffer than a normal plan, and turns them into a tick-off to-do list.
-- Objectives A (a new recipe from idea to customers without surprises),
-- C (never run out — ingredients ordered in time) and I (foresight).
--
-- test_boxes            — the box and its buffer settings. The deadlines are
--                          computed on read (lib/test-box-schedule.ts), never
--                          stored, so a changed supplier lead time or
--                          delivery date moves them automatically.
-- test_box_recipes      — which existing recipes are in it (2–4, enforced by
--                          the API; at most 4 here).
-- test_box_tasks        — ticks on the derived to-do list, keyed by the
--                          task's stable key ("orders-close", "order-supplier-3").
-- marketing_events.test_box_id — the box's own calendar event (selling window
--                          to delivery), kept in step by the API.
-- Soft delete (deleted_at) so a removed box's history survives.

CREATE TABLE IF NOT EXISTS test_boxes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  delivery_date DATE NOT NULL,
  audience TEXT NOT NULL DEFAULT 'vip_then_public'
    CHECK (audience IN ('vip', 'vip_then_public', 'public')),
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning', 'selling', 'ordering', 'producing', 'delivered', 'cancelled')),
  notes TEXT,
  -- Extra product made on top of orders, % (a normal plan carries far less).
  buffer_pct INTEGER NOT NULL DEFAULT 25 CHECK (buffer_pct BETWEEN 0 AND 200),
  -- Working days early that ingredients must land before prep day.
  buffer_days INTEGER NOT NULL DEFAULT 2 CHECK (buffer_days BETWEEN 0 AND 15),
  -- Calendar days the box is on sale before orders close.
  selling_days INTEGER NOT NULL DEFAULT 14 CHECK (selling_days BETWEEN 1 AND 120),
  -- Working days between orders closing and production.
  orders_close_days INTEGER NOT NULL DEFAULT 2 CHECK (orders_close_days BETWEEN 0 AND 20),
  -- VIP-then-public: days VIPs get before everyone else.
  vip_head_start_days INTEGER NOT NULL DEFAULT 3 CHECK (vip_head_start_days BETWEEN 0 AND 60),
  -- Expected boxes sold (optional) — drives the packs-to-make figure.
  expected_boxes INTEGER CHECK (expected_boxes IS NULL OR expected_boxes BETWEEN 0 AND 100000),
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
CREATE INDEX IF NOT EXISTS ix_test_boxes_delivery ON test_boxes (delivery_date) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS test_box_recipes (
  id SERIAL PRIMARY KEY,
  test_box_id INTEGER NOT NULL REFERENCES test_boxes(id) ON DELETE CASCADE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (test_box_id, recipe_id)
);

CREATE TABLE IF NOT EXISTS test_box_tasks (
  id SERIAL PRIMARY KEY,
  test_box_id INTEGER NOT NULL REFERENCES test_boxes(id) ON DELETE CASCADE,
  task_key TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  done_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  done_by_name TEXT,
  done_at TIMESTAMP,
  UNIQUE (test_box_id, task_key)
);

ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS test_box_id INTEGER REFERENCES test_boxes(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_marketing_events_test_box ON marketing_events (test_box_id) WHERE test_box_id IS NOT NULL;
