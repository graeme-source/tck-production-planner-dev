-- Migration: Add type column to improvement_submissions
-- Allows distinguishing between improvement ideas and struggles

ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'improvement';
