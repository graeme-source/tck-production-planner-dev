-- Return-to-work attachments (Graeme, 2026-09-16): appointment letters, fit
-- notes and other documentation (PDF or image) filed against a form. Same
-- privacy boundary as the form itself — the colleague and the named RTW
-- managers only, enforced by the routes. Bytes live in Postgres like the
-- documents repository and improvement photos, so backups carry them.
CREATE TABLE IF NOT EXISTS return_to_work_attachments (
  id serial PRIMARY KEY,
  form_id integer NOT NULL REFERENCES return_to_work_forms(id) ON DELETE CASCADE,
  file_name text,
  mime text NOT NULL,
  data bytea NOT NULL,
  uploaded_by_user_id integer REFERENCES app_users(id) ON DELETE SET NULL,
  uploaded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_rtw_attachments_form ON return_to_work_attachments (form_id, created_at);
