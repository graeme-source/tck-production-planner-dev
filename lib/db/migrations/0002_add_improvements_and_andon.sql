-- Migration: Add Improvements (Kaizen) and Andon issue tracking tables
-- Adds improvement_submissions and andon_issues tables plus their enum types

DO $$ BEGIN
  CREATE TYPE improvement_approval_tier AS ENUM ('minor', 'medium', 'major');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE improvement_progress_status AS ENUM ('submitted_for_review', 'approved', 'testing', 'complete');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE andon_severity AS ENUM ('yellow', 'red');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE andon_category AS ENUM ('equipment', 'safety', 'production', 'product', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS improvement_submissions (
  id serial PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  station text NOT NULL,
  submitted_by integer REFERENCES app_users(id) ON DELETE SET NULL,
  submitted_by_name text,
  approval_tier improvement_approval_tier,
  progress_status improvement_progress_status NOT NULL DEFAULT 'submitted_for_review',
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS andon_issues (
  id serial PRIMARY KEY,
  category andon_category NOT NULL,
  severity andon_severity NOT NULL,
  description text,
  station text NOT NULL,
  reported_by integer REFERENCES app_users(id) ON DELETE SET NULL,
  reported_by_name text,
  acknowledged_by integer REFERENCES app_users(id) ON DELETE SET NULL,
  acknowledged_by_name text,
  acknowledged_at timestamp,
  resolved_by integer REFERENCES app_users(id) ON DELETE SET NULL,
  resolved_by_name text,
  resolved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
