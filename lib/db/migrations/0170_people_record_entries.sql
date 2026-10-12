-- The employment record: entries, classified (Graeme, 2026-10-12).
--
-- "I want to put someone's employment status as 'in review' and a reason
-- for that review… issue verbal warnings, keep notes, book meetings and
-- reviews." Then: "reduce the number of options for recording something,
-- but allow classifications for that record to be the defining part, so
-- it's really simple and easy to use."
--
-- So: ONE kind of row, people_record_entries, added with one form. Its
-- classification (an editable list) switches on a few extra field sets —
-- stage & warnings, rating, pay change, probation outcome, fit for work —
-- as DATA (field_sets), never by matching a name. Rules + tests:
-- lib/people-reviews. API: routes/people-reviews.ts — private People PIN,
-- founder or People-data grant (never on your own record), the shared
-- employmentRecordWrite guard on every write, every read and write in
-- people_record_audit.
--
-- Nothing here is ever shown or sent to the employee. Nothing is deleted:
-- an entry closes (and can reopen), a warning is withdrawn, and changing an
-- entry's classification keeps every value it holds (fields the new one
-- doesn't use are hidden, and come back if it's changed back).

CREATE TABLE IF NOT EXISTS people_record_classifications (
  id          SERIAL PRIMARY KEY,
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  -- Any of: stage, rating, pay, probation, fitness
  field_sets  TEXT[] NOT NULL DEFAULT '{}'
              CHECK (field_sets <@ ARRAY['stage', 'rating', 'pay', 'probation', 'fitness']::TEXT[]),
  -- Which attendance figures to show as evidence: attendance | timekeeping
  evidence    TEXT CHECK (evidence IN ('attendance', 'timekeeping')),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed once, in Graeme's order (matches SEED_CLASSIFICATIONS).
INSERT INTO people_record_classifications (label, sort_order, field_sets, evidence)
SELECT * FROM (VALUES
  ('Performance appraisal',               10, ARRAY['rating', 'pay']::TEXT[],              NULL::TEXT),
  ('Probation review',                    20, ARRAY['rating', 'pay', 'probation']::TEXT[], NULL::TEXT),
  ('Disciplinary',                        30, ARRAY['stage']::TEXT[],                      NULL::TEXT),
  ('Attendance',                          40, ARRAY['stage']::TEXT[],                      'attendance'),
  ('Timekeeping',                         50, ARRAY['stage']::TEXT[],                      'timekeeping'),
  ('Health / fitness for work',           60, ARRAY['fitness']::TEXT[],                    NULL::TEXT),
  ('Grievance (raised by the employee)',  70, ARRAY[]::TEXT[],                             NULL::TEXT),
  ('Praise / recognition',                80, ARRAY[]::TEXT[],                             NULL::TEXT),
  ('Training & qualifications',           90, ARRAY[]::TEXT[],                             NULL::TEXT),
  ('Contract change (role, hours, pay)', 100, ARRAY['pay']::TEXT[],                        NULL::TEXT),
  ('Other',                              110, ARRAY[]::TEXT[],                             NULL::TEXT)
) AS seed(label, sort_order, field_sets, evidence)
WHERE NOT EXISTS (SELECT 1 FROM people_record_classifications);

-- The stage ladder used by classifications with the 'stage' field set.
-- Behaviour hangs off type / formal / rank, never the label.
CREATE TABLE IF NOT EXISTS people_review_stages (
  id                     SERIAL PRIMARY KEY,
  label                  TEXT NOT NULL,
  rank                   INTEGER NOT NULL,
  -- discussion | plan | warning | outcome (outcome = recorded only, e.g. dismissal)
  type                   TEXT NOT NULL CHECK (type IN ('discussion', 'plan', 'warning', 'outcome')),
  formal                 BOOLEAN NOT NULL DEFAULT FALSE,
  default_expiry_months  INTEGER CHECK (default_expiry_months IS NULL OR (default_expiry_months BETWEEN 1 AND 60)),
  optional               BOOLEAN NOT NULL DEFAULT FALSE,
  active                 BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO people_review_stages (label, rank, type, formal, default_expiry_months, optional)
SELECT * FROM (VALUES
  ('Informal discussion',   10, 'discussion', FALSE, NULL::INTEGER, FALSE),
  ('Improvement plan',      20, 'plan',       FALSE, NULL::INTEGER, TRUE),
  ('Verbal warning',        30, 'warning',    TRUE,  6,             TRUE),
  ('First written warning', 40, 'warning',    TRUE,  12,            FALSE),
  ('Final written warning', 50, 'warning',    TRUE,  12,            FALSE),
  ('Dismissal',             60, 'outcome',    TRUE,  NULL::INTEGER, FALSE)
) AS seed(label, rank, type, formal, default_expiry_months, optional)
WHERE NOT EXISTS (SELECT 1 FROM people_review_stages);

CREATE TABLE IF NOT EXISTS people_record_entries (
  id                     SERIAL PRIMARY KEY,
  user_id                INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  classification_id      INTEGER NOT NULL REFERENCES people_record_classifications(id),
  entry_date             DATE NOT NULL DEFAULT CURRENT_DATE,
  title                  TEXT NOT NULL DEFAULT '',
  notes                  TEXT,
  notes_updated_by_name  TEXT,
  notes_updated_at       TIMESTAMP,
  -- open = "Open — in review"; closed = just on the record / review over
  status                 TEXT NOT NULL DEFAULT 'closed' CHECK (status IN ('open', 'closed')),
  closed_on              DATE,
  -- While open: the review PERIOD (start → last day). Extending keeps the
  -- history in people_record_audit ("Extended by 1 month to 12 Jan 2027").
  review_start           DATE,
  review_end             DATE,
  outcome                TEXT,
  next_review_date       DATE,
  review_todo_id         INTEGER REFERENCES todo_tasks(id) ON DELETE SET NULL,
  -- Field set: stage
  stage_id               INTEGER REFERENCES people_review_stages(id) ON DELETE SET NULL,
  warning_expires_on     DATE,
  warning_withdrawn_at   TIMESTAMP,
  warning_withdrawn_reason TEXT,
  -- Field set: rating
  rating                 TEXT CHECK (rating IN ('below', 'meets', 'exceeds')),
  -- Field set: pay
  pay_from               TEXT,
  pay_to                 TEXT,
  pay_effective_on       DATE,
  -- Field set: probation
  probation_outcome      TEXT CHECK (probation_outcome IN ('passed', 'extended', 'not_passed')),
  probation_new_end      DATE,
  -- Field set: fitness
  fit_for_work           TEXT CHECK (fit_for_work IN ('yes', 'no', 'oh_referral')),
  -- Optional meeting (London wall-clock date + time)
  meeting_type           TEXT CHECK (meeting_type IN ('informal_chat', 'review', 'investigation', 'disciplinary', 'appeal')),
  meeting_date           DATE,
  meeting_time           TEXT CHECK (meeting_time IS NULL OR meeting_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  meeting_attendees      TEXT,
  meeting_checklist      TEXT[] NOT NULL DEFAULT '{}',
  meeting_todo_id        INTEGER REFERENCES todo_tasks(id) ON DELETE SET NULL,
  created_by_id          INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name        TEXT,
  created_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (warning_expires_on IS NULL OR warning_expires_on >= entry_date)
);
CREATE INDEX IF NOT EXISTS ix_people_record_entries_user ON people_record_entries (user_id, entry_date DESC);

-- Every look and every change: who, whose, which entry, what. Append-only;
-- names snapshotted. Also the entry's own history ("Reclassified from X to Y").
CREATE TABLE IF NOT EXISTS people_record_audit (
  id               SERIAL PRIMARY KEY,
  viewer_id        INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  viewer_name      TEXT,
  subject_user_id  INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  entry_id         INTEGER REFERENCES people_record_entries(id) ON DELETE SET NULL,
  action           TEXT NOT NULL,
  detail           TEXT,
  at               TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_people_record_audit_subject ON people_record_audit (subject_user_id, at DESC);
CREATE INDEX IF NOT EXISTS ix_people_record_audit_entry ON people_record_audit (entry_id, at);

-- ── Letters ────────────────────────────────────────────────────────────────
-- "The ability, where appropriate, to generate letters and send them to
-- employees to inform them of important updates such as written warnings."
--
-- Templates: editable by the founder. WHICH are offered for an entry is data
-- here — the field set its classification must use, an exact stage or a
-- stage type, a probation outcome, whether it needs a meeting or a pay
-- change (templatesForEntry in lib/people-reviews). Merge fields like
-- {firstName} are filled from the entry; anything missing shows as [gap].
CREATE TABLE IF NOT EXISTS people_letter_templates (
  id                 SERIAL PRIMARY KEY,
  key                TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  body               TEXT NOT NULL,
  field_set          TEXT CHECK (field_set IN ('stage', 'rating', 'pay', 'probation', 'fitness')),
  stage_id           INTEGER REFERENCES people_review_stages(id) ON DELETE SET NULL,
  stage_type         TEXT CHECK (stage_type IN ('discussion', 'plan', 'warning', 'outcome')),
  probation_outcome  TEXT CHECK (probation_outcome IN ('passed', 'extended', 'not_passed')),
  requires_meeting   BOOLEAN NOT NULL DEFAULT FALSE,
  requires_pay       BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by_name    TEXT,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seeded wording: plain English, in line with the ACAS Code. The warning
-- letters are tied to their seeded stage by label here, at seed time only.
INSERT INTO people_letter_templates (key, title, field_set, stage_id, stage_type, probation_outcome, requires_meeting, requires_pay, sort_order, body)
VALUES
('formal_meeting_invite', 'Invitation to a formal meeting', 'stage', NULL, NULL, NULL, TRUE, FALSE, 10, $$PRIVATE AND CONFIDENTIAL

{date}

Dear {firstName},

INVITATION TO A {meetingType}

I am writing to ask you to attend a {meetingType} on {meetingDate} at {meetingTime}.

WHAT IT IS ABOUT
{reason}

Copies of the information we will be looking at are enclosed, or will be given to you before the meeting. Please read them, and bring anything you would like us to consider.

WHAT COULD HAPPEN
The meeting may result in a formal warning. [Edit this to say what could happen — for example a first written warning, a final written warning, or dismissal.] No decision has been made yet; it will only be made after we have heard what you have to say.

YOUR RIGHT TO BE ACCOMPANIED
{companionRight}

If you or your companion cannot make this time, please tell me straight away and suggest another time within five working days.

Yours sincerely,

{signature}
{signatoryName}
The Calzone Kitchen$$),
('verbal_warning', 'Verbal warning — confirmation', 'stage', (SELECT id FROM people_review_stages WHERE label = 'Verbal warning' ORDER BY id LIMIT 1), NULL, NULL, FALSE, FALSE, 20, $$PRIVATE AND CONFIDENTIAL

{date}

Dear {firstName},

CONFIRMATION OF A VERBAL WARNING

Following our meeting on {meetingDate}, I am writing to confirm that you have been given a verbal warning.

THE REASON
{reason}

WHAT MUST IMPROVE
{outcome}

We will review how things are going on {reviewDate}. Please talk to me if there is anything that would help you make these improvements.

HOW LONG IT LASTS
This warning will stay on your record until {expiryDate}. After that it will be disregarded for disciplinary purposes, as long as there are no further problems.

If the improvement is not made, or there are further problems, the next step may be a first written warning.

YOUR RIGHT OF APPEAL
You have the right to appeal against this decision. If you wish to appeal, please write to me by {appealBy} saying why.

Yours sincerely,

{signature}
{signatoryName}
The Calzone Kitchen$$),
('first_written_warning', 'First written warning', 'stage', (SELECT id FROM people_review_stages WHERE label = 'First written warning' ORDER BY id LIMIT 1), NULL, NULL, FALSE, FALSE, 30, $$PRIVATE AND CONFIDENTIAL

{date}

Dear {firstName},

FIRST WRITTEN WARNING

Following our meeting on {meetingDate}, I am writing to confirm that you have been given a first written warning.

THE REASON
{reason}

WHAT MUST IMPROVE
{outcome}

We will review how things are going on {reviewDate}. Please talk to me if there is anything that would help you make these improvements.

HOW LONG IT LASTS
This warning will stay on your record until {expiryDate}. After that it will be disregarded for disciplinary purposes, as long as there are no further problems.

If the improvement is not made, or there are further problems, the next step may be a final written warning.

YOUR RIGHT OF APPEAL
You have the right to appeal against this decision. If you wish to appeal, please write to me by {appealBy} saying why.

Yours sincerely,

{signature}
{signatoryName}
The Calzone Kitchen$$),
('final_written_warning', 'Final written warning', 'stage', (SELECT id FROM people_review_stages WHERE label = 'Final written warning' ORDER BY id LIMIT 1), NULL, NULL, FALSE, FALSE, 40, $$PRIVATE AND CONFIDENTIAL

{date}

Dear {firstName},

FINAL WRITTEN WARNING

Following our meeting on {meetingDate}, I am writing to confirm that you have been given a final written warning.

THE REASON
{reason}

WHAT MUST IMPROVE
{outcome}

We will review how things are going on {reviewDate}. Please talk to me if there is anything that would help you make these improvements.

HOW LONG IT LASTS
This warning will stay on your record until {expiryDate}. After that it will be disregarded for disciplinary purposes, as long as there are no further problems.

This is a final warning. If the improvement is not made, or there are further problems while this warning is live, the next step may be dismissal.

YOUR RIGHT OF APPEAL
You have the right to appeal against this decision. If you wish to appeal, please write to me by {appealBy} saying why.

Yours sincerely,

{signature}
{signatoryName}
The Calzone Kitchen$$),
('improvement_plan', 'Improvement plan', 'stage', NULL, 'plan', NULL, FALSE, FALSE, 50, $$PRIVATE AND CONFIDENTIAL

{date}

Dear {firstName},

YOUR IMPROVEMENT PLAN

Thank you for talking things through with me. This letter sets out what we agreed.

WHAT WE TALKED ABOUT
{reason}

WHAT GOOD LOOKS LIKE
{outcome}

We will meet again on {reviewDate} to look at how it is going. This plan is informal and is not a warning — it is here to help you succeed. Please come and see me at any time if something is getting in the way.

Yours sincerely,

{signature}
{signatoryName}
The Calzone Kitchen$$),
('dismissal', 'Dismissal', 'stage', NULL, 'outcome', NULL, FALSE, FALSE, 60, $$PRIVATE AND CONFIDENTIAL

{date}

Dear {firstName},

TERMINATION OF YOUR EMPLOYMENT

Following our meeting on {meetingDate}, I am writing to confirm our decision to end your employment with The Calzone Kitchen.

THE REASON
{reason}

[Edit this paragraph: your last day of employment, your notice period and whether it will be worked or paid in lieu, and any holiday or other pay you are owed.]

YOUR RIGHT OF APPEAL
You have the right to appeal against this decision. If you wish to appeal, please write to me by {appealBy} saying why. The appeal will be heard, where possible, by someone who has not been involved so far.

Yours sincerely,

{signature}
{signatoryName}
The Calzone Kitchen$$),
('probation_passed', 'Probation passed', 'probation', NULL, NULL, 'passed', FALSE, FALSE, 70, $${date}

Dear {firstName},

YOUR PROBATION

I am pleased to confirm that you have successfully completed your probationary period. Thank you for everything you have put in so far.

{outcome}

Your employment continues on the terms of your contract.

Yours sincerely,

{signature}
{signatoryName}
The Calzone Kitchen$$),
('probation_extended', 'Probation extended', 'probation', NULL, NULL, 'extended', FALSE, FALSE, 80, $$PRIVATE AND CONFIDENTIAL

{date}

Dear {firstName},

EXTENSION OF YOUR PROBATION

Following our review, I am writing to confirm that your probationary period has been extended until {newEndDate}.

WHY
{reason}

WHAT WE NEED TO SEE
{outcome}

We will review this again on {reviewDate}. Please talk to me if there is anything that would help.

Yours sincerely,

{signature}
{signatoryName}
The Calzone Kitchen$$),
('probation_not_passed', 'Probation not passed', 'probation', NULL, NULL, 'not_passed', FALSE, FALSE, 90, $$PRIVATE AND CONFIDENTIAL

{date}

Dear {firstName},

OUTCOME OF YOUR PROBATION

Following our review meeting on {meetingDate}, I am sorry to confirm that you have not passed your probationary period, and your employment with The Calzone Kitchen will end.

WHY
{reason}

[Edit this paragraph: your last day of employment, your notice and any pay you are owed.]

If you wish to appeal against this decision, please write to me by {appealBy} saying why.

Yours sincerely,

{signature}
{signatoryName}
The Calzone Kitchen$$),
('pay_change', 'Pay change confirmation', 'pay', NULL, NULL, NULL, FALSE, TRUE, 100, $${date}

Dear {firstName},

CHANGE TO YOUR PAY

I am writing to confirm a change to your pay. From {effectiveDate}, your pay will change from {payFrom} to {payTo}.

All other terms of your contract stay the same. Please keep this letter with your contract.

Yours sincerely,

{signature}
{signatoryName}
The Calzone Kitchen$$),
('general', 'General letter', NULL, NULL, NULL, NULL, FALSE, FALSE, 200, $${date}

Dear {firstName},

{reason}

{outcome}

Yours sincerely,

{signature}
{signatoryName}
The Calzone Kitchen$$)
ON CONFLICT (key) DO NOTHING;

-- One letter, made from an entry. draft (editable, autosaved) → filed (PDF
-- in their Documents, not shared) → sent (shared with them; maybe an email
-- saying it's waiting — never the letter itself) → read → acknowledged.
CREATE TABLE IF NOT EXISTS people_letters (
  id                  SERIAL PRIMARY KEY,
  entry_id            INTEGER NOT NULL REFERENCES people_record_entries(id) ON DELETE CASCADE,
  user_id             INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  template_id         INTEGER REFERENCES people_letter_templates(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  body                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'filed', 'sent')),
  signatory_name      TEXT,
  document_id         INTEGER REFERENCES person_documents(id) ON DELETE SET NULL,
  filed_at            TIMESTAMP,
  sent_at             TIMESTAMP,
  sent_by_name        TEXT,
  emailed_to          TEXT,
  emailed_at          TIMESTAMP,
  read_at             TIMESTAMP,
  acknowledged_at     TIMESTAMP,
  created_by_id       INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name     TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_people_letters_entry ON people_letters (entry_id);
CREATE INDEX IF NOT EXISTS ix_people_letters_user ON people_letters (user_id) WHERE status = 'sent';

-- HR settings, founder-edited, one row:
--   • who the "a letter is waiting" emails come from. NULLs mean the
--     defaults: "The Calzone Kitchen HR", hr@<the app's verified sending
--     domain>, replies to the founder. Only the part before the @ is stored
--     — the domain is always the verified one (hrEmailIdentity).
--   • the Needs-attention lead times, in days.
CREATE TABLE IF NOT EXISTS people_hr_settings (
  id               INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  from_name        TEXT,
  from_local       TEXT,
  reply_to         TEXT,
  probation_days   INTEGER NOT NULL DEFAULT 14 CHECK (probation_days BETWEEN 1 AND 90),
  review_days      INTEGER NOT NULL DEFAULT 7 CHECK (review_days BETWEEN 1 AND 90),
  warning_days     INTEGER NOT NULL DEFAULT 14 CHECK (warning_days BETWEEN 1 AND 90),
  updated_by_name  TEXT,
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
INSERT INTO people_hr_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Probation per person: start → end, and the outcome once decided. A row
-- is made the first time someone sets or decides it; until then the
-- Needs-attention queue works it out from their contract start date +
-- probation length (app_users.probation_months, else the
-- probation_default_months setting) — only for starters on or after the
-- probation_prompt_from_hire_date setting, so long-standing staff whose
-- probation was handled by hand are never flagged.
CREATE TABLE IF NOT EXISTS people_probation (
  user_id          INTEGER PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  outcome          TEXT CHECK (outcome IN ('passed', 'not_passed')),
  decided_on       DATE,
  updated_by_name  TEXT,
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
