-- Sub-tasks on personal to-dos, and to-dos started from a team list
-- (Graeme, 25 Nov 2026). Objectives E and F. Safe to run twice.
--
-- todo_subtasks: an ordered checklist under a to-do, each ticked on its own
-- (who and when). Starting a "When needed" team-list process copies the
-- master's sub-tasks in here as a snapshot — later edits to the master never
-- change a copy that's already been started.
--
--   done_at / done_by / done_by_name   NULL = not ticked yet
--
-- todo_tasks.source_team_list_item_id: the team-list task this to-do was
-- started from ("From Marketing → Ads checklist", with a link back), and how
-- the master card knows when it was last run and by whom. NULL for every
-- other to-do. The master is only ever archived (active = false), so the
-- link survives; SET NULL covers a list being deleted outright.

CREATE TABLE IF NOT EXISTS todo_subtasks (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES todo_tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  done_at TIMESTAMP,
  done_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  done_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS todo_subtasks_task_idx ON todo_subtasks (task_id, sort_order);

ALTER TABLE todo_tasks ADD COLUMN IF NOT EXISTS source_team_list_item_id INTEGER
  REFERENCES team_list_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS todo_tasks_source_item_idx ON todo_tasks (source_team_list_item_id)
  WHERE source_team_list_item_id IS NOT NULL;
