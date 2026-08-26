-- Voting, and tying improvements back to what we teach (Objective E —
-- Graeme, 2026-08-26: "allow people to just add a vote to that improvement
-- idea or issue to build up a level of priority and importance for it").
--
-- 1. Votes. When someone reports a problem that's already been reported, the
--    useful thing isn't a second copy — it's a second voice. A vote is one
--    person saying "this one matters to me too", so the count is a measure of
--    how many people the problem actually affects. One vote per person per
--    improvement, enforced here rather than trusted to the screen.
CREATE TABLE IF NOT EXISTS improvement_votes (
  id SERIAL PRIMARY KEY,
  improvement_id INTEGER NOT NULL REFERENCES improvement_submissions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (improvement_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_improvement_votes_improvement ON improvement_votes (improvement_id);

-- 2. Which lean subject an improvement belongs to — a 3S improvement, a
--    "leave it better than you found it" improvement, and so on. Linked to
--    the SUBJECT rather than to a week or a lesson: subjects are stable,
--    while weeks get re-ordered and rewritten in the curriculum planner, so
--    a link to a week would rot within a month.
--
--    subject_source records who decided: 'ai' when it was suggested
--    automatically, 'human' once someone has confirmed or changed it. That
--    distinction is what stops an unreviewed guess being read as fact.
ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS subject_id INTEGER REFERENCES lean_subjects(id) ON DELETE SET NULL;
ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS subject_source TEXT;

CREATE INDEX IF NOT EXISTS ix_improvements_subject ON improvement_submissions (subject_id);
