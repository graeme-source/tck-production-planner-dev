-- One build, one credit (Graeme, 27 Oct 2026). Jane's issue #328 repeated
-- her own #248 ("Split with another supplier"), so the one build was
-- credited twice when the corrected rule re-credited genuine fixes. The
-- repeat's Fix-queue improvement is deleted (credits and notifications
-- cascade) and the report marked "nothing to do" so it's never re-credited;
-- #248 keeps its credit. From now on the code skips any repeat of an earlier
-- approved/built request (isRepeatOfEarlierRequest). Safe to run twice.

DELETE FROM improvement_submissions s
 USING andon_issues a
 WHERE a.improvement_id = s.id
   AND a.id = 328
   AND s.description LIKE '%and completed through the Fix queue.';

UPDATE issue_triage
   SET no_action_at = COALESCE(no_action_at, NOW()), improvement_id = NULL, updated_at = NOW()
 WHERE andon_issue_id = 328;
