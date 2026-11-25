-- "No review required" per person (Graeme, 25 Nov 2026): "I want to be able
-- to set, for each person, that they don't have reviews" — directors,
-- owners, contractors. The People list's Last review column then shows them
-- muted and never flags them as overdue. Objective H. Safe to run twice.
--
-- One row per person, made the first time the switch is used; no row = the
-- default (reviews required). Switching it off keeps the row (false) so
-- who changed it and when stays visible; every change is also written to
-- people_record_audit by the API. Nobody is seeded — Graeme sets them.

CREATE TABLE IF NOT EXISTS people_review_settings (
  user_id              INTEGER PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  no_review_required   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by           INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_name      TEXT,
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);
