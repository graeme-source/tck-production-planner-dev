-- Fix queue: unread replies from the reporter (Graeme, 21 Oct 2026).
-- Objectives E and F.
--
-- "I don't think I can see Jane's replies to my messages to her in the
-- issue Fix queue. Resolve that so it's very obvious."
--
-- issue_triage.founder_read_at — when Graeme last read the card's
-- conversation. The reporter's typed replies after it are UNREAD: a badge on
-- the card, the card sorted to the top, and a count on the Fix queue nav.
-- Kept apart from reporter_reply_at (which holds the card in To review until
-- he acts on it), so reading a reply never makes the card jump tab.
--
-- Backfill: every existing card counts as read now, so old history doesn't
-- light up as "new" — except a card already flagged with a reply he hasn't
-- acted on, which stays unread.
--
-- Data fix: a "Got it" on a message used to flag the card "New reply from
-- <name>" although nothing was written (#336 and #337, 20 Oct). That is now
-- a read receipt, so a flag with no typed reply since Graeme's last message
-- is cleared. Typed replies are untouched.
--
-- Idempotent: the column is added once; re-running the updates is harmless
-- (they only touch rows that still match).

ALTER TABLE issue_triage ADD COLUMN IF NOT EXISTS founder_read_at TIMESTAMPTZ;

UPDATE issue_triage
SET founder_read_at = now()
WHERE founder_read_at IS NULL AND reporter_reply_at IS NULL;

UPDATE issue_triage t
SET reporter_reply_at = NULL,
    founder_read_at = COALESCE(t.founder_read_at, now())
WHERE t.reporter_reply_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM issue_triage_events e
    WHERE e.triage_id = t.id
      AND e.event = 'reporter_replied'
      AND e.id > COALESCE((
        SELECT MAX(m.id) FROM issue_triage_events m
        WHERE m.triage_id = t.id AND m.event IN ('messaged', 'messaged_reporter', 'answered')
      ), 0)
  );
