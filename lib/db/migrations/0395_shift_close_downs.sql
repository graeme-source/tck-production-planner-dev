-- "Close down the packing and wrapping shift" (Graeme, 24 Nov 2026). Once
-- everything is packed and wrapped and the packing and wrapping checklists
-- are all actioned, the team closes the shift down; the room run rate
-- (api lib/room-kpi.ts) counts their paid hours only up to that moment.
-- Nothing else reads it — payroll, Planday and hours-worked are unchanged.
--
--  shift_close_downs — one row per London day while it is closed down.
--    Reopening deletes the row (the KPI then counts whole shifts again).
--  shift_close_down_events — every close and reopen, who and when: the audit.
--
-- Objective E. Safe to run twice.

CREATE TABLE IF NOT EXISTS shift_close_downs (
  date DATE PRIMARY KEY,
  closed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  closed_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  closed_by_name TEXT
);

CREATE TABLE IF NOT EXISTS shift_close_down_events (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  -- 'close' | 'reopen'
  action TEXT NOT NULL,
  -- The close-down time this event set or removed.
  closed_at TIMESTAMP,
  user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  user_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shift_close_down_events_date_idx ON shift_close_down_events (date, created_at);
