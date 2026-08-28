-- Photos, screenshots and videos on issue reports (Graeme, 2026-08-28):
-- people report with what they can see — a photo of the problem, a
-- screenshot of the app misbehaving, a short clip. Mirrors
-- improvement_attachments (same kinds, same bytea storage).

CREATE TABLE IF NOT EXISTS andon_attachments (
  id serial PRIMARY KEY,
  issue_id integer NOT NULL REFERENCES andon_issues(id) ON DELETE CASCADE,
  kind text NOT NULL,           -- 'image' | 'video'
  mime text NOT NULL,
  data bytea NOT NULL,
  file_name text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_andon_attachments_issue ON andon_attachments (issue_id);
