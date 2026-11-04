-- Keeping people in the loop on app reports (Graeme, 4 Nov 2026: "they're not
-- finding out", and the same thing gets reported two or three times).
-- Followers = people told about a report's progress as well as its reporter
-- (pressed "Keep me posted" when AI Jane found it was already reported).
CREATE TABLE IF NOT EXISTS andon_issue_followers (
  andon_issue_id INTEGER NOT NULL REFERENCES andon_issues(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at     TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (andon_issue_id, user_id)
);

-- Every check AI Jane does before an app report is filed, so what she answered
-- (and what never reached the Fix queue because of it) can be seen and judged.
-- outcome: already_possible | already_reported | new. result: what the person
-- did: resolved | followed | reported, NULL if they walked away.
CREATE TABLE IF NOT EXISTS issue_report_checks (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  user_name        TEXT,
  description      TEXT NOT NULL,
  outcome          TEXT NOT NULL,
  reply            TEXT NOT NULL,
  path             TEXT,
  matched_issue_id INTEGER REFERENCES andon_issues(id) ON DELETE SET NULL,
  result           TEXT,
  filed_issue_id   INTEGER REFERENCES andon_issues(id) ON DELETE SET NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS issue_report_checks_created_idx ON issue_report_checks (created_at DESC);
