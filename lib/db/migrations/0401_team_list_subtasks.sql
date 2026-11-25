-- Sub-tasks on team-list tasks (Graeme, 25 Nov 2026): "within each of those
-- processes we can open it up, expand it, and see all of the subtasks".
-- An ordered checklist under a team-list task — the master copy. On the
-- list they are read-only steps (no ticks of their own); starting a "When
-- needed" process copies them onto a personal to-do, where each one is
-- ticked (migration 0402).
--
--   title / notes / url   the step, an optional how-to, an optional link
--                         (a page in the app or a website — the title links)
--   sort_order            the list's own order, 1-based
--
-- Objectives E and F. Safe to run twice.

CREATE TABLE IF NOT EXISTS team_list_subtasks (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES team_list_items(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS team_list_subtasks_item_idx ON team_list_subtasks (item_id, sort_order);
