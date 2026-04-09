-- Migration: Add in_development status + andon_comments table
--
-- 1. Extend improvement_progress_status enum with `in_development`
-- 2. Create andon_comments table (mirrors improvement_comments for andon issues)
--
-- Note: this project uses `drizzle-kit push` (schema-driven) for DDL, so these
-- changes mirror the updated schema/improvements_and_andon.ts.
--
-- IMPORTANT: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction in
-- PostgreSQL. If your migration runner wraps files in a transaction, split the
-- ALTER TYPE statements into their own file and run them first.

-- 1. Extend progress status enum with `in_development` (idempotent)
ALTER TYPE improvement_progress_status ADD VALUE IF NOT EXISTS 'in_development' BEFORE 'testing';

-- 2. Create andon_comments table (mirrors improvement_comments)
CREATE TABLE IF NOT EXISTS andon_comments (
  id serial PRIMARY KEY,
  andon_id integer NOT NULL REFERENCES andon_issues(id) ON DELETE CASCADE,
  user_id integer REFERENCES app_users(id) ON DELETE SET NULL,
  user_name text,
  comment text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS andon_comments_andon_id_idx ON andon_comments(andon_id);
