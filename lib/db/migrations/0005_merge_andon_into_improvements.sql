-- Migration: Merge andon_issues into improvement_submissions + add comments table
--
-- This migration unifies the Andon Log and Improvement Log into a single table,
-- adds a new `in_development` progress status, and introduces an improvement_comments
-- table used by both issues and improvements in the UI.
--
-- Note: this project uses `drizzle-kit push` (schema-driven) for DDL, so the DDL
-- changes here mirror the updated schema/improvements_and_andon.ts. The backfill
-- block is the important part of this file — it cannot be expressed in the schema.
--
-- IMPORTANT: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction in
-- PostgreSQL. If your migration runner wraps files in a transaction, split the
-- ALTER TYPE statements into their own file and run them first.
--
-- Recommended run order (manual):
--   1. psql < 0005_merge_andon_into_improvements.sql    (adds cols + backfills data)
--   2. drizzle-kit push                                  (adds comments table, new enum value)
-- The legacy andon_issues table is NOT dropped by this migration — it is retained
-- for safety and will be removed in a follow-up once all callers have migrated.

-- 1. Extend progress status enum with `in_development` (idempotent)
ALTER TYPE improvement_progress_status ADD VALUE IF NOT EXISTS 'acknowledged' BEFORE 'approved';
ALTER TYPE improvement_progress_status ADD VALUE IF NOT EXISTS 'in_development' BEFORE 'testing';
ALTER TYPE improvement_progress_status ADD VALUE IF NOT EXISTS 'rejected';

-- 2. Add issue-specific nullable columns to improvement_submissions
ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS category andon_category;
ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS severity andon_severity;
ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS acknowledged_by integer REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS acknowledged_by_name text;
ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS acknowledged_at timestamp;
ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS resolved_by integer REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS resolved_by_name text;
ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS resolved_at timestamp;

-- 3. Create improvement_comments table
CREATE TABLE IF NOT EXISTS improvement_comments (
  id serial PRIMARY KEY,
  submission_id integer NOT NULL REFERENCES improvement_submissions(id) ON DELETE CASCADE,
  user_id integer REFERENCES app_users(id) ON DELETE SET NULL,
  user_name text,
  comment text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS improvement_comments_submission_id_idx ON improvement_comments(submission_id);

-- 4. Backfill andon_issues rows into improvement_submissions as type='issue'.
-- Uses a NOT EXISTS guard keyed on created_at + station + category to keep the
-- migration idempotent in case it's run twice.
INSERT INTO improvement_submissions (
  title,
  description,
  station,
  type,
  category,
  severity,
  submitted_by,
  submitted_by_name,
  acknowledged_by,
  acknowledged_by_name,
  acknowledged_at,
  resolved_by,
  resolved_by_name,
  resolved_at,
  progress_status,
  created_at,
  updated_at
)
SELECT
  COALESCE(
    NULLIF(LEFT(a.description, 60), ''),
    a.category::text || ' — ' || a.severity::text
  ),
  COALESCE(a.description, ''),
  a.station,
  'issue',
  a.category,
  a.severity,
  a.reported_by,
  a.reported_by_name,
  a.acknowledged_by,
  a.acknowledged_by_name,
  a.acknowledged_at,
  a.resolved_by,
  a.resolved_by_name,
  a.resolved_at,
  (CASE
    WHEN a.resolved_at IS NOT NULL THEN 'complete'
    WHEN a.acknowledged_at IS NOT NULL THEN 'acknowledged'
    ELSE 'submitted_for_review'
  END)::improvement_progress_status,
  a.created_at,
  a.created_at
FROM andon_issues a
WHERE NOT EXISTS (
  SELECT 1 FROM improvement_submissions i
  WHERE i.type = 'issue'
    AND i.created_at = a.created_at
    AND i.station = a.station
    AND i.category IS NOT DISTINCT FROM a.category
    AND i.severity IS NOT DISTINCT FROM a.severity
);

-- 5. andon_issues is intentionally NOT dropped by this migration.
--    Drop it in a follow-up once downstream callers (dashboard banner, station
--    badge, report modal) have been migrated off /api/andon.
