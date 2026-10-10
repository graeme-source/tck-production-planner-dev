-- Forced testing, round 2 (Graeme, 2026-10-10). Objectives E and F.
--
-- 1. No repeated nagging. The two-hour "Not now" cycle is gone (its columns
--    from 0159 stay, unused). A tester sees the card once — or, for a test
--    tied to a place, each time they ARRIVE there — and can put it on their
--    to-do list instead, after which it never pops up again:
--      prompted_at   when the card was first shown (no-place tests show once)
--      todo_task_id  the to-do it was put on (todo_tasks; ticked when they
--                    answer, removed if the request is closed while open)
-- 2. A test request can come from an improvement idea as well as an issue:
--      improvement_id  its submitter is the default tester
-- 3. Fix queue "Dismiss — no action": the card leaves the queue silently (no
--    message, notification or email to anyone), the hourly reviewer never
--    picks the issue up again, and it can be restored from "Dismissed".
--      issue_triage.no_action_at / no_action_by / no_action_by_user_id
-- 4. Improvement ideas that read like requests to change the app are
--    SUGGESTED to the Fix queue (a pure, tested word check — no paid API);
--    nothing goes in without Graeme's "Add to fix queue".
--      improvement_fix_suggestions  one row per idea checked: flagged + why,
--      status suggested | added | dismissed, who decided and when, and the
--      andon issue made when it was added (the reviewer picks that up).

ALTER TABLE test_request_testers ADD COLUMN IF NOT EXISTS prompted_at TIMESTAMPTZ;
ALTER TABLE test_request_testers ADD COLUMN IF NOT EXISTS todo_task_id INTEGER REFERENCES todo_tasks(id) ON DELETE SET NULL;

ALTER TABLE test_requests ADD COLUMN IF NOT EXISTS improvement_id INTEGER REFERENCES improvement_submissions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS test_requests_improvement_idx ON test_requests (improvement_id);

ALTER TABLE issue_triage ADD COLUMN IF NOT EXISTS no_action_at TIMESTAMPTZ;
ALTER TABLE issue_triage ADD COLUMN IF NOT EXISTS no_action_by TEXT;
ALTER TABLE issue_triage ADD COLUMN IF NOT EXISTS no_action_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS improvement_fix_suggestions (
  id                  SERIAL PRIMARY KEY,
  improvement_id      INTEGER NOT NULL UNIQUE REFERENCES improvement_submissions(id) ON DELETE CASCADE,
  flagged             BOOLEAN NOT NULL,
  reasons             TEXT[] NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'suggested',
  andon_issue_id      INTEGER REFERENCES andon_issues(id) ON DELETE SET NULL,
  decided_by          TEXT,
  decided_by_user_id  INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  decided_at          TIMESTAMPTZ,
  scanned_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
