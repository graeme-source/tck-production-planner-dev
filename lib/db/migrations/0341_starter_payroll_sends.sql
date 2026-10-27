-- New-starter payroll paperwork sent straight to the accountant
-- (Graeme, 27 Oct 2026). Objectives B and I.
--
-- As soon as a starter has finished everything payroll needs (pre-arrival
-- details, HMRC starter checklist, payroll details with a payslip email,
-- plus a P45 if they uploaded one), their payroll paperwork is emailed to
-- the accountant once, automatically, so it can be set up on Workforce
-- before the month-end payroll report (which attaches it again).
--
-- Every attempt is logged: who it was about, to whom, which documents,
-- by whom (NULL = automatic), and how it went. The health questionnaire is
-- never among the documents (lib/payroll/starter-send-rules.ts).
--
-- ONE automatic attempt per person, ever — the partial unique index is the
-- claim that stops two signatures landing together from sending twice.
-- Manual "Send again" rows (trigger = 'manual') are unlimited.
--
-- The accountant's address lives in app_settings under the key
-- 'payroll_accountant_email' (no schema change needed for that).

CREATE TABLE IF NOT EXISTS starter_payroll_sends (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('auto', 'manual')),
  -- sending → sent | failed; not_sent = no accountant email set at the time.
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'not_sent')),
  sent_to TEXT,
  documents TEXT[] NOT NULL DEFAULT '{}',
  error TEXT,
  sent_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  sent_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS starter_payroll_sends_one_auto
  ON starter_payroll_sends (user_id) WHERE trigger = 'auto';

CREATE INDEX IF NOT EXISTS starter_payroll_sends_user
  ON starter_payroll_sends (user_id, created_at DESC);
