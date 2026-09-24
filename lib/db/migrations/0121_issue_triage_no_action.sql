-- Fix queue: "Dismiss — already done" (Graeme, 2026-09-24).
--
-- Many reports turn out to be fixed or built already, withdrawn, or not a
-- problem. For those, "Approve" wrongly implies work is coming. The reviewer
-- now flags them no_action_needed, and the Fix queue offers Dismiss instead:
-- one tap closes the report on the andon log (status 'dismissed' — a text
-- value, no enum to change) and, when Claude drafted a reply, sends it to the
-- reporter as "A reply to your report".
ALTER TABLE issue_triage ADD COLUMN IF NOT EXISTS no_action_needed BOOLEAN NOT NULL DEFAULT false;
