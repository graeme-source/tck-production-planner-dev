-- Payroll report sends (Graeme, 26 Oct 2026). Objective B.
--
-- Finance → Payroll emails the monthly Planday payroll report (PDF + the
-- joiners' starter forms) to addresses typed in at the time. Payroll and
-- starter forms are personal data leaving the building, so every send is
-- logged: which period, to whom, by whom, what was attached.

CREATE TABLE IF NOT EXISTS payroll_report_sends (
  id SERIAL PRIMARY KEY,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  sent_to TEXT[] NOT NULL,
  attachments TEXT[] NOT NULL DEFAULT '{}',
  sent_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  sent_by_name TEXT,
  ok BOOLEAN NOT NULL,
  error TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
