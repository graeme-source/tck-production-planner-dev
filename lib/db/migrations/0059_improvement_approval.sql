-- The Improvement Centre: approval, credit, and the media rule
-- (Objective E — Graeme, 2026-08-26).
--
-- An improvement now has a life: someone logs it, someone does it, a manager
-- approves it, and the person who did it gets the credit. Until now every
-- submission sat in one undifferentiated pile and nothing was ever approved
-- or credited to anyone.
--
-- The existing progress_status enum already carried most of what's needed
-- (complete, rejected) but had no state for "I've done this, please check
-- it". Adding one rather than re-purposing an existing value keeps the
-- meaning of the rows already on live intact: everything logged so far is
-- 'submitted_for_review', which reads as "to do", and that stays true.
--
-- ALTER TYPE ... ADD VALUE runs inside a transaction on PostgreSQL 12+ as
-- long as the new value isn't USED in the same transaction. This migration
-- only adds it; application code starts using it on the next request, well
-- after this commits.
ALTER TYPE improvement_progress_status ADD VALUE IF NOT EXISTS 'awaiting_approval';

-- Who approved it and when — the audit trail behind the credit.
ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS approved_by_name TEXT;
ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;

-- Who actually carried the improvement out. Defaults to whoever logged it,
-- but a manager can move the credit on approval — the person who did the
-- work isn't always the person who typed it in.
ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS credited_to INTEGER REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS credited_to_name TEXT;

-- Why it was sent back, so the person knows what to change.
ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS review_note TEXT;

-- When the person said it was done — the clock the approval queue sorts by.
ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS done_at TIMESTAMP;

-- Anything already marked complete predates approval; credit it to whoever
-- it was assigned to so the per-person counts start from the real history
-- rather than from zero.
UPDATE improvement_submissions
   SET credited_to = COALESCE(credited_to, assigned_to, submitted_by),
       credited_to_name = COALESCE(credited_to_name, assigned_to_name, submitted_by_name)
 WHERE progress_status = 'complete';

CREATE INDEX IF NOT EXISTS ix_improvements_status ON improvement_submissions (progress_status);
CREATE INDEX IF NOT EXISTS ix_improvements_credited ON improvement_submissions (credited_to);
