-- Crediting an improvement to more than one person (Graeme, 2026-09-24:
-- "I did an improvement with Bodan recently, and I can only assign it to
-- me currently"). Objectives E (continuous improvement) and H (personal
-- recognition).
--
-- improvement_credits holds EVERYONE an improvement is credited to.
-- improvement_submissions.credited_to stays as the lead (the first person in
-- the list), so anything that reads a single name keeps working. The
-- scoreboard and every per-person view count the union of the two — see
-- lib/db/src/improvement-credits.ts.
--
-- position orders the names on the card ("Graeme & Bodan"); the lead is
-- always shown first regardless.
--
-- ON DELETE CASCADE on user_id matches credited_to's ON DELETE SET NULL:
-- either way a deleted user stops being credited.
CREATE TABLE IF NOT EXISTS improvement_credits (
  id SERIAL PRIMARY KEY,
  improvement_id INTEGER NOT NULL REFERENCES improvement_submissions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  user_name TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_improvement_credit UNIQUE (improvement_id, user_id)
);

-- "What has this person been credited with" — the scoreboard and My
-- Improvements. The unique constraint already covers lookups by improvement.
CREATE INDEX IF NOT EXISTS ix_improvement_credits_user ON improvement_credits (user_id);

-- Backfill: every improvement already credited gets its one credited person
-- as a row, so nothing changes for existing data.
INSERT INTO improvement_credits (improvement_id, user_id, user_name, position)
SELECT id, credited_to, credited_to_name, 0
  FROM improvement_submissions
 WHERE credited_to IS NOT NULL
ON CONFLICT (improvement_id, user_id) DO NOTHING;
