-- Dog bins: a second kind of quality reject (Graeme, 2026-09-25: "They're
-- both quality rejects, but some of them are going to be dog bins, and some
-- of them are wonkies. Two different classifications of quality rejects.").
-- Objectives C (the stock prediction must not count packs that were thrown
-- away) and E (defects recorded where they happen, so they can be reduced).
--
--   Wonky   = cooked but not pretty enough for a normal pack. Still sellable:
--             it sits on the Wonky Rack and is transferred to Wonky stock in
--             the Product Freezer (wonly_count / wonly_total, unchanged).
--   Dog bin = too far gone even for Wonky stock. Thrown away. It never goes
--             to the freezer, the fridge or any stock count.
--
-- 1) production_plan_items.dog_bin_count — packs of this plan item thrown in
--    the dog bin. Never reset (there is no rack to transfer from), so it is
--    also the day's total for reporting.
ALTER TABLE production_plan_items
  ADD COLUMN IF NOT EXISTS dog_bin_count INTEGER NOT NULL DEFAULT 0;

-- 2) quality_reject_events — who tapped + or − on either counter, and when,
--    so a correction can be traced. Wonky taps had no audit trail before;
--    both kinds now write one row per tap. The counters on
--    production_plan_items stay the source of truth for every calculation;
--    this table is the trail behind them.
CREATE TABLE IF NOT EXISTS quality_reject_events (
  id            SERIAL PRIMARY KEY,
  plan_id       INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  plan_item_id  INTEGER NOT NULL REFERENCES production_plan_items(id) ON DELETE CASCADE,
  recipe_id     INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('wonky', 'dog_bin')),
  delta         INTEGER NOT NULL CHECK (delta IN (1, -1)),
  station_type  TEXT,
  user_id       INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quality_reject_events_item
  ON quality_reject_events (plan_item_id, created_at);
