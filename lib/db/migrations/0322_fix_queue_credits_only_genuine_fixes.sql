-- Fix-queue credits: only for a report that was genuinely fixed (Graeme,
-- 27 Oct 2026: "They don't get a credit just for reporting things... we want
-- that to be credited once it is fixed and deemed to be working").
--
-- Of the credits made under the old rule (24 Sep – 21 Oct), these nine had
-- nothing built because of them:
--   already existed when reported: issues 164, 199, 204, 209, 211, 212, 217
--   repeat of a request already credited: 216 (same build as 187),
--                                          317 (same request as 310)
-- Their Fix-queue improvements are deleted (credits, votes and notifications
-- cascade; issue and triage are unlinked) and the reports are marked "nothing
-- to do" (no_action_at) so the credit sweep never re-credits them. The other
-- credits were genuine fixes and stay. Safe to run twice.

DELETE FROM improvement_submissions s
 USING andon_issues a
 WHERE a.improvement_id = s.id
   AND a.id IN (164, 199, 204, 209, 211, 212, 216, 217, 317)
   AND s.description LIKE '%and completed through the Fix queue.';

UPDATE issue_triage
   SET no_action_at = COALESCE(no_action_at, NOW()), improvement_id = NULL, updated_at = NOW()
 WHERE andon_issue_id IN (164, 199, 204, 209, 211, 212, 216, 217, 317);
