-- Team lists (Graeme, 2026-10-13). Objectives G (management's glance at
-- "is the routine done today?") and F (one tap, nothing lost).
--
-- Graeme is cancelling Todoist. A few roles keep recurring routines there —
-- the Production Planner's ~30-minute daily list, the Scheduling Manager's
-- weekly/Thursday list. They must NOT sit on one person's to-do list: when
-- the usual person is off, any manager (or Graeme) opens the same list and
-- ticks it, as themselves.
--
--   team_lists              one per role's routine. member_ids empty = every
--                           manager and admin may open it; set = only those
--                           people (plus admins). Archived, never deleted —
--                           the completions are history.
--   team_list_items         a recurring task. recurrence is a lib/recurrence
--                           rule (JSON). priority 1–4 as in Todoist (1 =
--                           most urgent). carry_over: if missed, it stays as
--                           "Overdue" until done, skipped or its next
--                           occurrence. start_date: occurrences before it are
--                           ignored (reset when the rule changes), so a new
--                           item is never born overdue. active = false hides
--                           a removed item but keeps its history.
--   team_list_completions   one row per item per occurrence date (London):
--                           done or skipped, by whom and when.
--
-- Idempotent: re-running changes nothing.

CREATE TABLE IF NOT EXISTS team_lists (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  emoji           TEXT,
  color           TEXT,
  member_ids      INTEGER[] NOT NULL DEFAULT '{}',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_by_id   INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  archived_at     TIMESTAMP,
  archived_by_id  INTEGER REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS team_list_items (
  id              SERIAL PRIMARY KEY,
  list_id         INTEGER NOT NULL REFERENCES team_lists(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  notes           TEXT,
  url             TEXT,
  priority        SMALLINT NOT NULL DEFAULT 4 CHECK (priority BETWEEN 1 AND 4),
  recurrence      JSONB NOT NULL DEFAULT '{"kind":"daily"}'::jsonb,
  time_of_day     TEXT CHECK (time_of_day IS NULL OR time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  carry_over      BOOLEAN NOT NULL DEFAULT FALSE,
  start_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_id   INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS team_list_items_list_idx ON team_list_items (list_id);

CREATE TABLE IF NOT EXISTS team_list_completions (
  id              SERIAL PRIMARY KEY,
  item_id         INTEGER NOT NULL REFERENCES team_list_items(id) ON DELETE CASCADE,
  due_date        DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('done', 'skipped')),
  by_user_id      INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  by_name         TEXT,
  at              TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT team_list_completions_item_date UNIQUE (item_id, due_date)
);
CREATE INDEX IF NOT EXISTS team_list_completions_date_idx ON team_list_completions (due_date);
