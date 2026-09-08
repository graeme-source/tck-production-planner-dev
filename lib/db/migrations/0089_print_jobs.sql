-- Print jobs for the prep-room thermal label printer (TSC, direct thermal,
-- 100x25mm stock). The iPads can't reach a LAN printer from a cloud-hosted
-- web app, so labels are queued here and a bridge agent on a factory PC
-- long-polls for queued jobs and fires the rendered TSPL at the printer.
-- Every label ever printed stays here — who, what, when, which dates — a
-- HACCP audit trail a pen never gave us.
CREATE TABLE IF NOT EXISTS print_jobs (
  id SERIAL PRIMARY KEY,
  -- 'test' | 'ingredient' | 'tin' | 'freeze' | 'defrost' — what layout the
  -- payload was rendered with.
  kind TEXT NOT NULL,
  -- The structured fields the label was built from (item name, dates,
  -- initials…), kept for the audit trail and reprints.
  payload JSONB NOT NULL,
  -- The rendered TSPL sent to the printer, exactly as sent.
  tspl TEXT NOT NULL,
  -- Number of copies the job prints (rendered into the TSPL PRINT command).
  copies INTEGER NOT NULL DEFAULT 1,
  -- queued → printed | failed. Failed jobs keep their error for the UI.
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  -- Which bridge/printer this job is for — one station ('prep') today, but
  -- a second printer later must not mean a schema change.
  station TEXT NOT NULL DEFAULT 'prep',
  created_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  printed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_print_jobs_pending ON print_jobs (station, status, id);
