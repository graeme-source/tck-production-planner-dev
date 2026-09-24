-- Fix queue: snooze, and crediting completed improvements (Graeme, 2026-09-24).
--
--   snoozed_until   "Not now" — the card leaves To review until this moment,
--                   then comes back by itself (a Snoozed tab lists them).
--   completed_on    the day the fix or feature actually went live. When an
--                   improvement-lane report is closed, the improvement it
--                   earned is credited on THIS day — so ingesting an old
--                   report built back in June doesn't pile twenty
--                   "improvements completed" onto today's KPI.
--   improvement_id  the improvements record credited to the original
--                   reporter (also written to andon_issues.improvement_id,
--                   which already exists), so it's only ever credited once.
ALTER TABLE issue_triage ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;
ALTER TABLE issue_triage ADD COLUMN IF NOT EXISTS completed_on DATE;
ALTER TABLE issue_triage ADD COLUMN IF NOT EXISTS improvement_id INTEGER REFERENCES improvement_submissions(id) ON DELETE SET NULL;
