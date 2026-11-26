-- Current rate of pay and the last pay rise, from Planday (Graeme, 26 Nov
-- 2026: "automatically bring in their current rate of pay from the Plan Day
-- setting … look at the last change … when they last had a pay rise and at
-- what date"). One row per person, refreshed daily from Planday's pay rates
-- and two years of paid shifts. People access only (behind the People PIN).
-- Objective H. Safe to run twice.
CREATE TABLE IF NOT EXISTS people_pay_rates (
  user_id              INTEGER PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  planday_employee_id  INTEGER,
  -- Planday's rates for them, one per employee group: [{rate, wageType, salaryCode, employeeGroupId}]
  rates                JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The rate on their latest paid shift (what they're actually paid now), else the highest hourly rate
  current_rate         NUMERIC(10,4),
  wage_type            TEXT,
  -- First day the current rate was paid after a different one, and that rate
  last_change_on       DATE,
  previous_rate        NUMERIC(10,4),
  -- Every change seen: [{date, from, to}]
  changes              JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- How far back the shifts were read
  history_from         DATE,
  synced_at            TIMESTAMP NOT NULL DEFAULT NOW()
);
