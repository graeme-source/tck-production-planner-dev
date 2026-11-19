-- AI Jane talks a report or an app idea through before it's filed (Graeme,
-- 19 Nov 2026: "get that conversation had at the time of the person having
-- that thought"). One row per chat: what they first wrote, every question
-- and answer, and the summary that went into the report's text. Kept so the
-- Fix queue can show how a report was worked out. Objectives E and F.
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS report_chats (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  user_name TEXT,
  kind TEXT NOT NULL,
  andon_issue_id INTEGER REFERENCES andon_issues(id) ON DELETE CASCADE,
  improvement_id INTEGER REFERENCES improvement_submissions(id) ON DELETE CASCADE,
  original TEXT NOT NULL,
  transcript JSONB NOT NULL,
  brief TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS report_chats_andon_issue_idx ON report_chats (andon_issue_id);
CREATE INDEX IF NOT EXISTS report_chats_improvement_idx ON report_chats (improvement_id);
