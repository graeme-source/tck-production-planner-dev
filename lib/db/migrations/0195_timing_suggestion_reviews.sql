-- Timing data card on the Recipes page: dismiss a suggested build/cook time,
-- or send it to someone to review (Graeme, 2026-10-15: "Can you make it so I
-- can dismiss these suggested cooking times? Or send them to a certain person
-- to review."). Objective C (the day schedule runs on trustworthy timings).
--
-- One row per action, never updated except to mark a dismissal restored:
--   kind          'build' (recipe build time, target = recipe id) or
--                 'cook'  (meat cook time, target = ingredient id)
--   action        'dismissed' — hidden while the set value is unchanged and
--                 the suggestion hasn't moved much (timing-review-rules.ts);
--                 'sent' — put on assignee's to-do list (todo_task_id).
--   set_value / suggested_value   what was on the card at the time
--                 (seconds for build, minutes for cook).
CREATE TABLE IF NOT EXISTS timing_suggestion_reviews (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('build', 'cook')),
  target_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('dismissed', 'sent')),
  set_value INTEGER,
  suggested_value INTEGER,
  assignee_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  assignee_name TEXT,
  todo_task_id INTEGER,
  note TEXT,
  actor_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  actor_name TEXT,
  restored_at TIMESTAMPTZ,
  restored_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS timing_suggestion_reviews_target_idx ON timing_suggestion_reviews (kind, target_id);
