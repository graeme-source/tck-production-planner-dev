-- Fix queue: messaging the reporter keeps the card open (Graeme, 2026-10-13).
-- Objectives E and F.
--
-- Issue #323: Graeme asked Jane a question from the card, the message box's
-- "This answers it — close the report" was ticked by default, so the card
-- closed (answered, report resolved, improvement credited) and dropped out
-- of To review. Messaging the reporter is now a conversation:
--
--   issue_triage.awaiting_reporter_since  set by "Message <name>" (which no
--                                         longer closes anything); shown as
--                                         "Waiting for <name>'s reply".
--                                         Cleared when they answer, or when
--                                         the card is closed.
--   issue_triage.reporter_reply_at        the reporter answered (a typed
--                                         reply in their pop-up or on the
--                                         issue log, or "Got it" on a
--                                         question) and Graeme hasn't looked
--                                         yet: the card sits in To review
--                                         with "New reply from <name>" until
--                                         he acts on it. Never sent to Claude
--                                         by itself.
--
-- Idempotent: re-running changes nothing. No backfill.

ALTER TABLE issue_triage ADD COLUMN IF NOT EXISTS awaiting_reporter_since TIMESTAMPTZ;
ALTER TABLE issue_triage ADD COLUMN IF NOT EXISTS reporter_reply_at TIMESTAMPTZ;
