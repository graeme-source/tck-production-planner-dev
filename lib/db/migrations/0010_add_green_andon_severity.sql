-- Migration: Add `green` (Wish List) value to andon_severity enum
--
-- Adds a third priority tier so the issue log can capture nice-to-have
-- requests alongside Minor (yellow) and Serious (red) issues.
--
-- Note: this project uses `drizzle-kit push` (schema-driven) for DDL, so
-- this change mirrors the updated schema/improvements_and_andon.ts.
--
-- IMPORTANT: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction in
-- PostgreSQL. If your migration runner wraps files in a transaction, run
-- this statement on its own.

ALTER TYPE andon_severity ADD VALUE IF NOT EXISTS 'green';
