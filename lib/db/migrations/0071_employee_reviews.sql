-- Employee reviews, probation meetings and an ongoing record of a person's
-- time here (Graeme, 2026-09-03). Two tables:
--
--   employee_meetings — a review, probation meeting or 1:1. Booked for a
--                       date, written up afterwards.
--   employee_notes    — the diary: notes, feedback and objectives, each
--                       either PRIVATE to whoever wrote it or SHARED to the
--                       employee's own record. Private is the default: you
--                       write first and choose what to publish.
--
-- The employee reads their record and never writes to it. Private notes are
-- filtered out server-side (lib/db/src/employee-review-visibility.ts), never
-- hidden in the UI.

CREATE TABLE IF NOT EXISTS employee_meetings (
  id serial PRIMARY KEY,
  subject_user_id integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  -- 'review' | 'probation' | 'one_to_one'
  kind text NOT NULL DEFAULT 'review',
  title text,
  scheduled_for date,
  held_at timestamp,
  -- 'booked' | 'held' | 'cancelled'
  status text NOT NULL DEFAULT 'booked',
  created_by integer REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_employee_meetings_subject
  ON employee_meetings (subject_user_id, scheduled_for DESC);

CREATE TABLE IF NOT EXISTS employee_notes (
  id serial PRIMARY KEY,
  subject_user_id integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  -- Notes can stand alone (a diary entry) or belong to a meeting. Deleting a
  -- meeting must never destroy what was written about the person.
  meeting_id integer REFERENCES employee_meetings(id) ON DELETE SET NULL,
  -- 'note' | 'feedback' | 'objective'
  kind text NOT NULL DEFAULT 'note',
  body text NOT NULL,
  -- 'private' | 'shared'. Private until deliberately published.
  visibility text NOT NULL DEFAULT 'private',
  shared_at timestamp,
  -- Objectives only: what was agreed, and whether it has been done.
  due_date date,
  done_at timestamp,
  author_id integer REFERENCES app_users(id) ON DELETE SET NULL,
  author_name text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_employee_notes_subject
  ON employee_notes (subject_user_id, created_at DESC);

-- Probation length is per person: three months historically, six for anyone
-- joining from now on, and it can differ. NULL means "use the default".
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS probation_months integer;

INSERT INTO app_settings (key, value, updated_at)
VALUES
  ('probation_default_months', '6', NOW()),
  -- Lorna does the scheduling, so Lorna gets the to-do. Held as a setting
  -- rather than a name in code so it can move without a deploy.
  ('probation_scheduler_user_id', '', NOW()),
  -- Only nudge for people who START on or after this date. Everyone already
  -- employed has had their probation arranged by hand — Major Sarai's
  -- three-month review on 22 September was booked before this existed — and
  -- prompting Lorna about arrangements that already exist would make the
  -- feature noise on the day it arrived.
  ('probation_prompt_from_hire_date', '2026-09-03', NOW())
ON CONFLICT (key) DO NOTHING;

-- Point the nudge at Lorna if she is unambiguously identifiable here; if not,
-- the setting stays empty and the job stays quiet until someone sets it.
UPDATE app_settings SET value = (
  SELECT id::text FROM app_users
  WHERE is_active AND name ILIKE 'Lorna%'
  LIMIT 1
)
WHERE key = 'probation_scheduler_user_id'
  AND value = ''
  AND (SELECT COUNT(*) FROM app_users WHERE is_active AND name ILIKE 'Lorna%') = 1;

-- Major Sarai stays on the three months he was given, rather than inheriting
-- the new six-month default. His review is already arranged; this is only so
-- his record says the right thing.
UPDATE app_users SET probation_months = 3
WHERE is_active AND name ILIKE 'Major Sarai'
  AND probation_months IS NULL;
