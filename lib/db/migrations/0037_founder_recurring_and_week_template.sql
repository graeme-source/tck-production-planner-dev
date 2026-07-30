-- Founder Focus: recurring daily items + default weekly template seed.
--
-- Recurring items are per-pillar rituals ("30-min one-on-one coaching")
-- that surface as tickboxes inside that pillar's time block on the day
-- view. They only appear on days where the pillar actually has a block, so
-- a Tuesday template without Team & Coaching simply doesn't show them.
-- Tick state is one row per (item, date) — nothing to instantiate daily.
--
-- Also seeds Graeme's requested Mon-Fri default week (2026-07-30):
--   07:00-08:00 Team & Coaching
--   08:00-09:00 Sales & Marketing   (pillar renamed from "Sales")
--   09:00-12:00 Claude & Systems
--   12:00-14:00 Product
--   14:00-15:00 Team & Coaching
-- The template table already supports different rows per weekday; the seed
-- fills Mon-Fri identically and only runs when the table is empty, so
-- per-day edits are never overwritten.
--
-- Applied idempotently at API startup (runStartupMigrations), seed guarded
-- by _migrations_done key 'founder_focus_seed_v2'.

CREATE TABLE IF NOT EXISTS founder_recurring_items (
  id SERIAL PRIMARY KEY,
  pillar_id INTEGER NOT NULL REFERENCES founder_pillars(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  archived_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS founder_recurring_ticks (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES founder_recurring_items(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  ticked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, date)
);
