-- One review, classified (Graeme, 2026-10-12).
--
-- "I don't want a different feature for disciplinary reviews versus
-- performance reviews. I just want a review, and it can be for disciplinary
-- reasons or for performance. I want it to be a classification so I can go
-- back and change them."
--
-- There were two overlapping systems: the old meetings + notes
-- (employee_meetings / employee_notes, migration 0071) and the classified
-- employment-record entries (people_record_entries, migration 0170). The
-- entries win — they already have the editable classification,
-- reclassification that keeps hidden values, the stage ladder, letters and
-- the audit log. This file brings the old meetings' write-ups across:
--
--   • people_record_entries.meeting_status  booked | held | cancelled
--     (NULL = no meeting, just on the record) + held_at. A review is an
--     entry with a meeting status; the ACAS meeting_type stays an OPTIONAL
--     detail, never a second "kind" picked up front.
--   • people_review_notes — the write-up: feedback, objectives and notes,
--     each PRIVATE to its author until shared with the employee, exactly as
--     before (lib/db employee-review-visibility.ts still decides who reads
--     what, on the server). Attached to an entry, or loose (entry_id NULL)
--     for the old notes that were never part of a meeting — a private note
--     must not become an entry other People-access holders can see.
--     Nothing is hard-deleted: deleted_at hides one.
--   • A "1:1 / catch-up" classification (data, seeded once by label).
--   • Every old meeting → an entry (review → Performance appraisal,
--     probation → Probation review, one_to_one → 1:1 / catch-up), and every
--     old note → a review note, keeping author, dates, private/shared and
--     objective due/done. The old tables are left exactly as they were.
--
-- Idempotent: legacy_meeting_id / legacy_note_id are UNIQUE and every copy
-- skips rows already copied, so running it again changes nothing.

-- ── The 1:1 classification ─────────────────────────────────────────────────
INSERT INTO people_record_classifications (label, sort_order, field_sets, evidence)
SELECT '1:1 / catch-up', 25, ARRAY[]::TEXT[], NULL
WHERE NOT EXISTS (SELECT 1 FROM people_record_classifications WHERE lower(label) = lower('1:1 / catch-up'));

-- ── Entries: the review's own status ───────────────────────────────────────
ALTER TABLE people_record_entries ADD COLUMN IF NOT EXISTS meeting_status TEXT;
ALTER TABLE people_record_entries ADD COLUMN IF NOT EXISTS held_at TIMESTAMP;
ALTER TABLE people_record_entries ADD COLUMN IF NOT EXISTS legacy_meeting_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_record_entries_meeting_status_check') THEN
    ALTER TABLE people_record_entries ADD CONSTRAINT people_record_entries_meeting_status_check
      CHECK (meeting_status IS NULL OR meeting_status IN ('booked', 'held', 'cancelled'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS ux_people_record_entries_legacy_meeting
  ON people_record_entries (legacy_meeting_id) WHERE legacy_meeting_id IS NOT NULL;

-- Entries made since 0170 with a meeting date: booked, or held if the day
-- has passed. (Only rows with no status yet, so a re-run never overrides.)
UPDATE people_record_entries
   SET meeting_status = CASE WHEN meeting_date < CURRENT_DATE THEN 'held' ELSE 'booked' END
 WHERE meeting_status IS NULL AND meeting_date IS NOT NULL AND legacy_meeting_id IS NULL;

-- ── The write-up ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS people_review_notes (
  id              SERIAL PRIMARY KEY,
  -- NULL = a loose note on the record (only ever from the old diary).
  entry_id        INTEGER REFERENCES people_record_entries(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'feedback', 'objective')),
  title           TEXT,
  body            TEXT NOT NULL,
  -- private until deliberately shared with the employee
  visibility      TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
  shared_at       TIMESTAMP,
  due_date        DATE,
  done_at         TIMESTAMP,
  author_id       INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  author_name     TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMP,
  legacy_note_id  INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_people_review_notes_legacy
  ON people_review_notes (legacy_note_id) WHERE legacy_note_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_people_review_notes_entry ON people_review_notes (entry_id);
CREATE INDEX IF NOT EXISTS ix_people_review_notes_user ON people_review_notes (user_id, created_at DESC);

-- ── Copy the old meetings ──────────────────────────────────────────────────
-- Classification by label, at migration time only (as 0170 seeds letters).
-- If a label has since been renamed, Other, then the first in the list —
-- never a failed migration; it can be reclassified on screen.
WITH target AS (
  SELECT m.*,
         COALESCE(
           (SELECT c.id FROM people_record_classifications c
             WHERE lower(c.label) = lower(CASE m.kind
                                            WHEN 'probation'  THEN 'Probation review'
                                            WHEN 'one_to_one' THEN '1:1 / catch-up'
                                            ELSE 'Performance appraisal' END)
             ORDER BY c.id LIMIT 1),
           (SELECT c.id FROM people_record_classifications c WHERE lower(c.label) = 'other' ORDER BY c.id LIMIT 1),
           (SELECT c.id FROM people_record_classifications c ORDER BY c.sort_order, c.id LIMIT 1)
         ) AS classification_id
    FROM employee_meetings m
   WHERE NOT EXISTS (SELECT 1 FROM people_record_entries e WHERE e.legacy_meeting_id = m.id)
),
moved AS (
  INSERT INTO people_record_entries (
    user_id, classification_id, entry_date, title, status, closed_on,
    meeting_status, meeting_date, held_at,
    created_by_id, created_by_name, created_at, updated_at, legacy_meeting_id
  )
  SELECT t.subject_user_id, t.classification_id,
         COALESCE(t.scheduled_for, t.held_at::date, t.created_at::date),
         COALESCE(t.title, ''), 'closed', NULL,
         CASE WHEN t.status IN ('booked', 'held', 'cancelled') THEN t.status ELSE 'booked' END,
         t.scheduled_for, t.held_at,
         t.created_by, t.created_by_name, t.created_at, t.updated_at, t.id
    FROM target t
  RETURNING id, user_id, legacy_meeting_id
)
INSERT INTO people_record_audit (viewer_id, viewer_name, subject_user_id, entry_id, action, detail, at)
SELECT NULL, 'Moved across (migration 0178)', mv.user_id, mv.id, 'entry_add',
       'Moved from the old meetings list (' || COALESCE(m.kind, 'review') || ', booked by ' || COALESCE(m.created_by_name, 'someone') || ')',
       NOW()
  FROM moved mv JOIN employee_meetings m ON m.id = mv.legacy_meeting_id;

-- ── Copy the old notes ─────────────────────────────────────────────────────
-- Anything that isn't exactly 'shared' stays private (fail closed, as
-- employee-review-visibility.ts does). A note whose meeting is gone, or
-- that never had one, comes across loose (entry_id NULL).
INSERT INTO people_review_notes (
  entry_id, user_id, kind, title, body, visibility, shared_at, due_date, done_at,
  author_id, author_name, created_at, updated_at, legacy_note_id
)
SELECT e.id, n.subject_user_id,
       CASE WHEN n.kind IN ('note', 'feedback', 'objective') THEN n.kind ELSE 'note' END,
       n.title, n.body,
       CASE WHEN n.visibility = 'shared' THEN 'shared' ELSE 'private' END,
       CASE WHEN n.visibility = 'shared' THEN n.shared_at ELSE NULL END,
       n.due_date, n.done_at, n.author_id, n.author_name, n.created_at, n.updated_at, n.id
  FROM employee_notes n
  LEFT JOIN people_record_entries e ON e.legacy_meeting_id = n.meeting_id AND n.meeting_id IS NOT NULL
 WHERE NOT EXISTS (SELECT 1 FROM people_review_notes r WHERE r.legacy_note_id = n.id);
