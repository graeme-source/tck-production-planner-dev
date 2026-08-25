-- Weekly lean lesson reviews (Objective E — "make it impossible not to
-- learn"). Each person completes the week's lesson module once: the five
-- morning-meeting angles as pages plus a short quiz. Completion feeds the
-- Lean training matrix and closes the auto-created weekly to-do.

CREATE TABLE IF NOT EXISTS lean_lesson_reviews (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  principle_id INTEGER NOT NULL REFERENCES lean_principles(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  quiz_correct INTEGER,
  quiz_total INTEGER,
  completed_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);
CREATE INDEX IF NOT EXISTS ix_lean_reviews_week ON lean_lesson_reviews (week_start);

-- The week's quiz lives on the weekly principle: a JSON array of
-- { question, options[], answer } authored with the curriculum.
ALTER TABLE lean_principles ADD COLUMN IF NOT EXISTS quiz_json TEXT;

-- Lean training matrix items point at the weekly principle they certify,
-- so completing a review can auto-tick the right matrix cell.
ALTER TABLE training_matrix_items ADD COLUMN IF NOT EXISTS principle_id INTEGER REFERENCES lean_principles(id) ON DELETE SET NULL;

-- The auto-created weekly lean to-do is identified by the week it belongs
-- to (never by title matching).
ALTER TABLE todo_tasks ADD COLUMN IF NOT EXISTS lean_week_start DATE;
