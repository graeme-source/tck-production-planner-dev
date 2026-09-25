-- Documents on a person's record (Graeme, 2026-09-25: "Is it possible for
-- me, on people's timelines, just to post a document that gets stored in
-- their document section?"). Objectives I (the founder's one place for
-- everything about a person) and F (records we can trust — nothing lost,
-- nothing silently removed).
--
-- person_documents — any document filed on someone's record: a letter, a
-- certificate, right-to-work evidence, a training certificate, a warning or
-- disciplinary letter, anything else. The file itself (a PDF, or a photo of
-- the paper copy) is stored inline as bytea, like uploaded_contracts (0130).
--
-- Who sees it (enforced in routes/person-documents.ts; the pure rules and
-- their tests are lib/person-document-rules.ts):
--   visibility = 'people' → everyone with People access (the founder's
--                           per-person switch, migration 0126);
--   visibility = 'hr'     → the HR-records accounts only
--                           (middleware/hr-access.ts — the founder today).
--   New warning / disciplinary documents default to 'hr'; everything else
--   defaults to 'people'. Only an HR-records account can change it.
--   shared_with_employee → the person themself also sees it, read-only, in
--                           their Employee Hub (never the notes). Always
--                           starts FALSE — sharing is an explicit tick.
--
-- Never hard-deleted: "Remove" sets deleted_at / deleted_by, and the
-- trigger below refuses a DELETE outright, so a personnel document can't
-- vanish by accident or by a stray script. ON DELETE RESTRICT on the person
-- for the same reason (deactivate a leaver; never delete them out from
-- under their record).

CREATE TABLE IF NOT EXISTS person_documents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN (
    'letter', 'certificate', 'right_to_work', 'training_certificate',
    'warning', 'disciplinary', 'other'
  )),
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  document_date DATE NOT NULL,
  notes TEXT,
  file_name TEXT,
  mime TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  data BYTEA NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('people', 'hr')),
  shared_with_employee BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  uploaded_by_name TEXT,
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  deleted_by_name TEXT
);

-- The record page and the Employee Hub both list one person's live
-- documents, newest first.
CREATE INDEX IF NOT EXISTS person_documents_user_live_idx
  ON person_documents (user_id, document_date DESC)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION person_documents_refuse_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'person_documents rows are never deleted — set deleted_at instead (soft delete)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS person_documents_no_delete ON person_documents;
CREATE TRIGGER person_documents_no_delete
  BEFORE DELETE ON person_documents
  FOR EACH ROW EXECUTE FUNCTION person_documents_refuse_delete();
