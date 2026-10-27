-- Undo the improvements the Fix queue credited on 27 Oct 2026 (Graeme:
-- "we've accredited people with an improvement for reporting an issue...
-- fix it immediately"). The catch-up run closed a backlog of built
-- suggestions and each one created a completed improvement in the
-- REPORTER's name. Crediting from the Fix queue is now switched off in code
-- (isImprovementDue); this removes the ones it made today.
--
-- Only rows the Fix queue itself CREATED (its own description line) and
-- approved on/after 27 Oct are deleted. Their credits, votes, reactions and
-- notifications go with them (ON DELETE CASCADE); the issue and its triage
-- row are unlinked (ON DELETE SET NULL). Improvements people logged
-- themselves are never touched. Safe to run twice.

DELETE FROM improvement_submissions
 WHERE description LIKE '%and completed through the Fix queue.'
   AND approved_at >= TIMESTAMP '2026-10-27 00:00:00';
