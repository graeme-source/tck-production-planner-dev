-- Improvement approval becomes a setting, OFF by default (Graeme,
-- 2026-09-07): finishing an improvement puts it straight into the feed as
-- complete, with no manager review step — "get used to using it in the
-- simplest possible way first". The admin area on /improvements can turn
-- the approval step back on later.
INSERT INTO app_settings (key, value, updated_at)
VALUES ('improvement_approval_required', 'false', NOW())
ON CONFLICT (key) DO NOTHING;

-- Empty the current queue the same way turning the toggle off does: what's
-- sitting in "waiting for approval" goes into the feed now, not whenever
-- someone next finds the review list.
UPDATE improvement_submissions
SET progress_status = 'complete', approved_at = NOW(), updated_at = NOW()
WHERE progress_status = 'awaiting_approval';

UPDATE todo_tasks SET status = 'done', completed_at = NOW(), updated_at = NOW()
WHERE created_by_name = 'Improvement review' AND status = 'open';
