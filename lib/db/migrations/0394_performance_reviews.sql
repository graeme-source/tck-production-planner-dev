-- Performance pay review reports (Graeme, 24 Nov 2026): "an automatic report
-- that I can load up for any given person at any given time" for the
-- six-monthly performance pay reviews. Two tables:
--
--  people_performance_prep — private notes a manager writes in the lead-up
--    to someone's review. One running note per (person, author). Never shown
--    to the employee; only the author reads their own.
--  people_performance_reports — a frozen copy of the data report, taken when
--    it's used in a meeting and attached to that meeting's record entry. It
--    reaches the employee only once someone presses Share (shared_at).
--
-- Objective H. Safe to run twice.

CREATE TABLE IF NOT EXISTS people_performance_prep (
  id SERIAL PRIMARY KEY,
  subject_user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  author_user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_people_performance_prep UNIQUE (subject_user_id, author_user_id)
);

CREATE TABLE IF NOT EXISTS people_performance_reports (
  id SERIAL PRIMARY KEY,
  subject_user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  entry_id INTEGER REFERENCES people_record_entries(id) ON DELETE SET NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  data JSONB NOT NULL,
  created_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  shared_at TIMESTAMP,
  shared_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS people_performance_reports_subject_idx ON people_performance_reports (subject_user_id, created_at DESC);
