-- Migration: Add risk_assessments, compliance_actions, and compliance_action_completions
--
-- Powers the Risk Assessments feature under Reports. Each risk assessment is a
-- free-form markdown document (fire, food safety, general safety, etc.) with an
-- associated action plan. Actions can be one-off or recurring; marking a
-- recurring action complete auto-creates the next instance.
--
-- Note: this project uses `drizzle-kit push` (schema-driven) for DDL. This
-- file mirrors the updated schema in lib/db/src/schema/risk_assessments.ts.

CREATE TABLE IF NOT EXISTS risk_assessments (
  id                         serial PRIMARY KEY,
  assessment_type            text NOT NULL,
  title                      text NOT NULL,
  body_markdown              text NOT NULL DEFAULT '',
  status                     text NOT NULL DEFAULT 'draft',
  review_frequency_months    integer NOT NULL DEFAULT 12,
  last_reviewed_at           timestamp,
  next_review_due            date,
  last_reviewed_by_user_id   integer REFERENCES app_users(id) ON DELETE SET NULL,
  last_reviewed_by_name      text,
  reviewer_qualifications    text,
  created_at                 timestamp NOT NULL DEFAULT now(),
  updated_at                 timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance_actions (
  id                         serial PRIMARY KEY,
  risk_assessment_id         integer REFERENCES risk_assessments(id) ON DELETE SET NULL,
  title                      text NOT NULL,
  description                text,
  category                   text NOT NULL DEFAULT 'other',
  priority                   text NOT NULL DEFAULT 'medium',
  status                     text NOT NULL DEFAULT 'open',
  assigned_to_user_id        integer REFERENCES app_users(id) ON DELETE SET NULL,
  assigned_to_name           text,
  due_date                   date,
  recurrence                 text NOT NULL DEFAULT 'none',
  parent_action_id           integer,
  completed_at               timestamp,
  completed_by_user_id       integer REFERENCES app_users(id) ON DELETE SET NULL,
  completed_by_name          text,
  completion_notes           text,
  created_at                 timestamp NOT NULL DEFAULT now(),
  updated_at                 timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS compliance_actions_status_due_idx
  ON compliance_actions (status, due_date);
CREATE INDEX IF NOT EXISTS compliance_actions_ra_idx
  ON compliance_actions (risk_assessment_id);
CREATE INDEX IF NOT EXISTS compliance_actions_parent_idx
  ON compliance_actions (parent_action_id);

CREATE TABLE IF NOT EXISTS compliance_action_completions (
  id                         serial PRIMARY KEY,
  action_id                  integer NOT NULL REFERENCES compliance_actions(id) ON DELETE CASCADE,
  completed_at               timestamp NOT NULL DEFAULT now(),
  completed_by_user_id       integer REFERENCES app_users(id) ON DELETE SET NULL,
  completed_by_name          text NOT NULL,
  notes                      text,
  next_action_id             integer
);

CREATE INDEX IF NOT EXISTS compliance_completions_action_idx
  ON compliance_action_completions (action_id);
CREATE INDEX IF NOT EXISTS compliance_completions_at_idx
  ON compliance_action_completions (completed_at);
