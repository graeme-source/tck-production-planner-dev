-- "This was the last time they were reviewed" (Graeme, 26 Nov 2026): a date
-- set by hand on the People list for someone with no written review, so the
-- Last review column is accurate. A real review on a later date takes over.
-- Objective H. Safe to run twice.
ALTER TABLE people_review_settings ADD COLUMN IF NOT EXISTS last_review_marked_on DATE;
ALTER TABLE people_review_settings ADD COLUMN IF NOT EXISTS last_review_marked_by_name TEXT;
ALTER TABLE people_review_settings ADD COLUMN IF NOT EXISTS last_review_marked_at TIMESTAMP;
