-- Migration: turn risk_assessments into a generic documents repository
--
-- The existing risk_assessments table already has the right metadata for
-- review-cycle tracking (reviewFrequency, lastReviewed, nextReviewDue,
-- reviewerQualifications). To make it a home for insurance docs, certifications,
-- licences, etc, we add file storage (Postgres bytea) and broaden the type.
--
-- We keep the table name `risk_assessments` to avoid a destructive rename and
-- because the existing routes/UI still work; user-facing label is "Documents".
-- assessment_type is now a free-text category — values include: fire,
-- food_safety, general_safety, insurance, certification, licence, sop, other.
--
-- File contents are stored inline. PDFs in this system are 200KB–1MB; a
-- generous 15MB cap is enforced at the route layer.
--
-- Idempotent — safe to re-run.

ALTER TABLE risk_assessments
  ADD COLUMN IF NOT EXISTS file_blob          bytea,
  ADD COLUMN IF NOT EXISTS file_mime          text,
  ADD COLUMN IF NOT EXISTS file_name          text,
  ADD COLUMN IF NOT EXISTS file_size_bytes    integer,
  ADD COLUMN IF NOT EXISTS file_version       text,
  ADD COLUMN IF NOT EXISTS file_uploaded_at   timestamp,
  ADD COLUMN IF NOT EXISTS original_issue_date date;

-- Helpful index for the dashboard query that filters by review-due window.
CREATE INDEX IF NOT EXISTS risk_assessments_next_review_idx
  ON risk_assessments (next_review_due)
  WHERE status <> 'archived';
