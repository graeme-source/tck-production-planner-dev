-- Starter forms (Graeme, 2026-09-07): the HMRC starter checklist, TCK
-- payroll details and TCK health questionnaire become in-app forms a new
-- starter fills in and signs from their Employee Hub (and the first-login
-- onboarding flow). Same privacy and permanence rules as employment
-- contracts: owner + HR-records access only, drafts editable, signed
-- submissions frozen with an archival PDF, undeletable at the DB level.
--
-- Field definitions live in code (api-server/src/lib/starter-forms.ts) —
-- answers here are a JSONB snapshot keyed by those field names, and body is
-- the rendered plain-text document frozen at signing.

CREATE TABLE IF NOT EXISTS starter_form_submissions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  form_type TEXT NOT NULL,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  body TEXT,
  signed_initials TEXT,
  signed_at TIMESTAMP,
  signed_pdf BYTEA,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, form_type)
);

CREATE OR REPLACE FUNCTION starter_form_submissions_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.signed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Signed starter forms are permanent records and cannot be deleted (submission %)', OLD.id;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.signed_at IS NOT NULL THEN
    IF NEW.answers IS DISTINCT FROM OLD.answers
       OR NEW.body IS DISTINCT FROM OLD.body
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.form_type IS DISTINCT FROM OLD.form_type
       OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
       OR NEW.signed_initials IS DISTINCT FROM OLD.signed_initials
       OR (OLD.signed_pdf IS NOT NULL AND NEW.signed_pdf IS DISTINCT FROM OLD.signed_pdf) THEN
      RAISE EXCEPTION 'Signed starter forms are immutable (submission %)', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS starter_form_submissions_protect_delete ON starter_form_submissions;
CREATE TRIGGER starter_form_submissions_protect_delete
  BEFORE DELETE ON starter_form_submissions
  FOR EACH ROW EXECUTE FUNCTION starter_form_submissions_protect();

DROP TRIGGER IF EXISTS starter_form_submissions_protect_update ON starter_form_submissions;
CREATE TRIGGER starter_form_submissions_protect_update
  BEFORE UPDATE ON starter_form_submissions
  FOR EACH ROW EXECUTE FUNCTION starter_form_submissions_protect();

-- Self-filling onboarding matrix columns, same idea as principle_id
-- (migration 0055): a column marked with an auto_source is ticked by the
-- app when the underlying thing completes, not by hand.
--   'starter_paperwork'   — contract signed AND all three starter forms signed
--   'pre_arrival_details' — the pre-arrival onboarding form submitted
ALTER TABLE training_matrix_items ADD COLUMN IF NOT EXISTS auto_source TEXT;

-- One-time data fix for the live "New Colleague Onboarding" matrix: its
-- existing columns for paperwork and emergency contacts become self-filling.
-- Matched by their current exact labels; if a label was changed, nothing
-- happens and the column can be marked from the matrix admin instead.
UPDATE training_matrix_items SET auto_source = 'starter_paperwork'
  WHERE label = 'Docs to collect / Contract' AND auto_source IS NULL;
UPDATE training_matrix_items SET auto_source = 'pre_arrival_details'
  WHERE label = 'Emergency Contact Details' AND auto_source IS NULL;
