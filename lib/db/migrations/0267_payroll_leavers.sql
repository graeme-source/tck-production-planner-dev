-- Payroll leavers, added by hand (Graeme, 26 Oct 2026). Objective B.
--
-- Planday only marks someone as gone after their last payroll has run, so
-- the payroll report can't find this month's leavers itself. Finance →
-- Payroll has a Leavers panel where the founder or accountant adds them for
-- the pay period (keyed by the period's first day, the 25th).

CREATE TABLE IF NOT EXISTS payroll_leavers (
  id SERIAL PRIMARY KEY,
  period_from DATE NOT NULL,
  name TEXT NOT NULL,
  last_day DATE NOT NULL,
  note TEXT,
  added_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  added_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payroll_leavers_period_idx ON payroll_leavers (period_from);
