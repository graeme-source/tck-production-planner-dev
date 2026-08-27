-- Stock-gate holds: verification becomes a repeated observation, not a
-- one-shot verdict.
--
-- The old code checked each hold once, 60 seconds after tagging, and never
-- again. Whatever that early check said stuck forever, so a hold whose Zapiet
-- rule kicked in at minute three was still reported as "NOT blocking" all day
-- and the dashboard turned red about a product that was, in fact, blocked
-- (Graeme, 2026-08-27). These two columns let the poller re-check on a
-- schedule and only conclude anything once the readings settle.

ALTER TABLE stock_gate_holds
  ADD COLUMN IF NOT EXISTS verify_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verify_checked_at TIMESTAMP;

-- Existing rows were judged on a single early check. Anything recorded as
-- 'failed' on that basis is not trustworthy: clear it back to unchecked so
-- the new logic forms its own opinion. Verified rows are kept — a positive
-- confirmation could not have been a propagation artefact.
UPDATE stock_gate_holds
   SET verify_status = NULL, verify_note = NULL
 WHERE verify_status = 'failed'
   AND released_at IS NULL;
