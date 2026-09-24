-- Fix queue: message the reporter (Graeme, 2026-09-24).
--
-- Not every report needs code. Some are answered by telling the reporter
-- how to do it themselves — e.g. "set the oven override on the recipe form"
-- — and Graeme wants the team trained to fix what they can from the app's
-- own settings. So:
--
--   issue_triage.suggested_reply   Claude's draft message to the reporter,
--       with step-by-step instructions when they can solve it themselves.
--       Pre-fills Graeme's "Message the reporter" box; he edits and sends.
--   issue_fix_notices.kind         'fixed'   — "Your report has been fixed —
--                                              please test" (the original)
--                                  'message' — "A reply to your report",
--                                              Graeme's words
--   issue_triage.status 'answered' (text column, no enum change needed) —
--       closed by a message rather than a code fix.

ALTER TABLE issue_triage ADD COLUMN IF NOT EXISTS suggested_reply TEXT;
ALTER TABLE issue_fix_notices ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'fixed';
