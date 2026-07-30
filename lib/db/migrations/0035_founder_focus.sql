-- Founder Focus — founder-only time-blocking + priorities (Stage 1).
--
-- Pillars = the few areas only the founder can do, seeded 2026-07-30 from
-- Graeme's notebook (Claude/AI & systems, Sales, Team incentives & coaching,
-- Product?). Goals sit under pillars. Blocks are the day's time-boxed plan
-- (minutes from midnight against a DATE). Templates seed a default week
-- (weekday 0=Sunday, matching JS getDay()). Parking lot captures mid-block
-- distractions so they get written down instead of acted on.
--
-- Applied idempotently at API startup (runStartupMigrations); the pillar/goal
-- seed is guarded by _migrations_done key 'founder_focus_seed_v1' so edits or
-- deletions made later in the UI are never re-seeded.

CREATE TABLE IF NOT EXISTS founder_pillars (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  target_share_pct INTEGER,
  notes TEXT,
  archived_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS founder_goals (
  id SERIAL PRIMARY KEY,
  pillar_id INTEGER NOT NULL REFERENCES founder_pillars(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  done_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS founder_blocks (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  pillar_id INTEGER REFERENCES founder_pillars(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_founder_blocks_date ON founder_blocks (date);

CREATE TABLE IF NOT EXISTS founder_block_templates (
  id SERIAL PRIMARY KEY,
  weekday INTEGER NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  pillar_id INTEGER REFERENCES founder_pillars(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS founder_parking_lot (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP
);
