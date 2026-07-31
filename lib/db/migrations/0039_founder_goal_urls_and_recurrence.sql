-- Founder Focus: goal/ritual URLs + Todoist-style recurrence.
--
-- url: a dashboard/report link (Meta ads, Shopify analytics…) rendered as a
-- button so "opening numbers check" is tick + click, no hunting for tabs.
--
-- Recurrence on daily items (founder_recurring_items):
--   schedule      'daily' (default) | 'weekdays' | 'weekly' | 'biweekly'
--   schedule_day  0=Sunday..6=Saturday, for weekly/biweekly
--   anchor_date   a known occurrence date for biweekly parity ("every
--                 second Friday" = Fridays where whole-weeks-since-anchor
--                 is even)
-- An item appears on a date when its schedule matches AND its pillar has a
-- block that day (unchanged rule).
--
-- Applied idempotently at API startup (runStartupMigrations).

ALTER TABLE founder_goals ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE founder_recurring_items ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE founder_recurring_items ADD COLUMN IF NOT EXISTS schedule TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE founder_recurring_items ADD COLUMN IF NOT EXISTS schedule_day INTEGER;
ALTER TABLE founder_recurring_items ADD COLUMN IF NOT EXISTS anchor_date DATE;
