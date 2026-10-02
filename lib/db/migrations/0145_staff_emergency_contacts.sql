-- Staff emergency contacts (Graeme, 2026-10-02): "Have everyone's emergency
-- contact details available so we can access them easily through the front
-- end in an emergency involving one of our team." Staff safety.
--
-- Until now the only copy was the new-starter onboarding form
-- (onboarding_submissions.emergency_contact_*), which only starters since
-- the form went live ever filled in, which bundles the contact with address,
-- shoe size and the starter gate's "details submitted" tick, and which is
-- read only on the People record. This table is the ONE current emergency
-- contact per person:
--   • each person reads and updates their own at any time;
--   • managers and admins read anyone's (tap to reveal) and correct it;
--   • the onboarding form still collects it from new starters and writes
--     it through to here (routes/onboarding.ts), so nobody is asked twice.
-- The onboarding row stays as what the starter submitted on the day.
--
-- relationship is nullable only so the copy below can't drop an old answer
-- that left it blank; the API requires it on every save.
CREATE TABLE IF NOT EXISTS staff_emergency_contacts (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  phone                TEXT NOT NULL,
  relationship         TEXT,
  -- An optional second person to try.
  second_name          TEXT,
  second_phone         TEXT,
  second_relationship  TEXT,
  -- Where the current answer came from: self | manager | onboarding
  source               TEXT NOT NULL DEFAULT 'self'
                       CHECK (source IN ('self', 'manager', 'onboarding')),
  updated_by_id        INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_name      TEXT,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Every time someone reads (or corrects) a colleague's emergency contact:
-- who, whose, when, and from where. Append-only; names are snapshotted so
-- the log still reads correctly if an account is renamed.
CREATE TABLE IF NOT EXISTS staff_emergency_contact_views (
  id               SERIAL PRIMARY KEY,
  viewer_id        INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  viewer_name      TEXT,
  subject_user_id  INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  subject_name     TEXT,
  -- view | edit
  action           TEXT NOT NULL DEFAULT 'view' CHECK (action IN ('view', 'edit')),
  -- contacts_page | station | people_record
  source           TEXT NOT NULL,
  viewed_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_staff_emergency_contact_views_subject
  ON staff_emergency_contact_views (subject_user_id, viewed_at DESC);

-- Copy what the onboarding form already holds (name + phone present), so
-- nothing on file is lost and those people aren't asked again. Re-runnable:
-- an existing row for the person is never overwritten.
INSERT INTO staff_emergency_contacts
  (user_id, name, phone, relationship, source, created_at, updated_at)
SELECT o.user_id,
       TRIM(o.emergency_contact_name),
       TRIM(o.emergency_contact_phone),
       NULLIF(TRIM(o.emergency_contact_relationship), ''),
       'onboarding',
       COALESCE(o.submitted_at, o.updated_at),
       o.updated_at
FROM onboarding_submissions o
WHERE COALESCE(TRIM(o.emergency_contact_name), '') <> ''
  AND COALESCE(TRIM(o.emergency_contact_phone), '') <> ''
ON CONFLICT (user_id) DO NOTHING;
