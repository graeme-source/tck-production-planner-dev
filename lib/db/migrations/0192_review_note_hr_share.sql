-- People record: "Shared with HR" — a third level for every write-up part
-- and loose note (Graeme, 2026-10-14: "I also want the ability for me to
-- share with Lorna, but not with anyone else"). Objective H.
--
--   people_review_notes.shared_with_user_ids  the People-access colleagues
--       the author chose to let read a PRIVATE note. Empty (the default)
--       = private to the author, as every existing row is today.
--
-- Additive: visibility stays 'private' | 'shared'. An HR-shared note is a
-- private note with names on it, so anything that only looks at visibility
-- still treats it as private (fails closed). Who may read what is enforced
-- on the server (lib/db employee-review-visibility.ts): never the colleague
-- it's about, never anyone without People access.
--
-- Idempotent: re-running changes nothing. No backfill.

ALTER TABLE people_review_notes
  ADD COLUMN IF NOT EXISTS shared_with_user_ids INTEGER[] NOT NULL DEFAULT '{}';
