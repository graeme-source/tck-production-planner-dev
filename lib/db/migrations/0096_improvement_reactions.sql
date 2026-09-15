-- WhatsApp-style emoji reactions on improvements (Graeme, 2026-09-10):
-- the vote button decides what gets DONE; reactions are the applause.
-- One row per (improvement, person, emoji) — tapping again removes it.
CREATE TABLE IF NOT EXISTS improvement_reactions (
  id SERIAL PRIMARY KEY,
  improvement_id INTEGER NOT NULL REFERENCES improvement_submissions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (improvement_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS ix_improvement_reactions_improvement
  ON improvement_reactions (improvement_id);
