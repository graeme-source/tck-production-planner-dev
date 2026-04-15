-- Migration: Add Plan Day employee ID mapping to app_users
-- Maps each app user to their Plan Day employee (auto-populated by email match)
-- for attendance/sickness reporting.

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS planday_employee_id integer;
