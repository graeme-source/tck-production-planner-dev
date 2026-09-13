-- Versioned policy acceptances (Graeme, 2026-09-13): the single source of
-- truth for who has read & accepted which policy, at which version. When an
-- ACTIVE policy's body changes its version bumps, everyone gets a fresh
-- 3-day review to-do, and the Policies training matrix (a display layer
-- derived from these rows) unticks until they re-confirm.
ALTER TABLE risk_assessments ADD COLUMN IF NOT EXISTS policy_version integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS policy_acceptances (
  id serial PRIMARY KEY,
  policy_id integer NOT NULL REFERENCES risk_assessments(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  version integer NOT NULL,
  accepted_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_policy_acceptance UNIQUE (policy_id, user_id, version)
);
CREATE INDEX IF NOT EXISTS idx_policy_acceptances_user ON policy_acceptances(user_id);
