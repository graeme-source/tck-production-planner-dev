-- Founder Focus: day-to-day tasks.
--
-- Before this, the only tickable things inside a time block were the pillar's
-- long-term GOALS and its recurring rituals. That meant "something I need to
-- do today" had to be created as a goal, which then stuck to the pillar for
-- ever and reappeared in every block of that pillar on every day.
--
-- founder_tasks is the missing layer: a one-off item that belongs to a date.
-- Unfinished tasks stay on their original date and are surfaced as overdue
-- for the founder to reschedule deliberately.
CREATE TABLE IF NOT EXISTS founder_tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  detail TEXT,
  url TEXT,
  pillar_id INTEGER REFERENCES founder_pillars(id) ON DELETE SET NULL,
  block_id INTEGER REFERENCES founder_blocks(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  done_at TIMESTAMP,
  source TEXT NOT NULL DEFAULT 'manual',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_founder_tasks_date ON founder_tasks (date, status);
