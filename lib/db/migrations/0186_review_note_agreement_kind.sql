-- "What was agreed" as ONE bulleted list per review (Graeme, 2026-10-13).
-- Objective H.
--
-- "If there's a list of things we agree, we should just have a list of
-- agreed points and put them in bullets in one section. We don't need to add
-- a different objective for each of them. And they're not to-dos… We don't
-- need to mark it as done."
--
--   • people_review_notes.kind gains 'agreement': a write-up part whose body
--     is the bulleted list of agreed points ("• …" one per line). It has no
--     due date and is never done. Private to its author until shared, and
--     shared with the rest of the write-up — exactly like the other parts.
--   • Why a kind and not the entry's outcome field: the outcome lives on the
--     review entry, which is People-access only and never the colleague's to
--     read; a write-up part already carries author, private/shared, sharing,
--     notifications, soft delete and the audit trail.
--   • 'objective' now means a PERFORMANCE objective only.
--
-- Additive: the CHECK only widens; no existing row is changed. Splitting
-- one review's AI-made objectives back into one list is a separate,
-- per-entry script (artifacts/api-server/scripts/
-- merge-review-objectives-into-agreement.ts), never run from here.
--
-- Idempotent: re-running gives the same constraint.

ALTER TABLE people_review_notes DROP CONSTRAINT IF EXISTS people_review_notes_kind_check;
ALTER TABLE people_review_notes ADD CONSTRAINT people_review_notes_kind_check
  CHECK (kind IN ('note', 'feedback', 'objective', 'agreement'));
