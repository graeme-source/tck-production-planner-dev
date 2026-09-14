-- Planday attendance mirror (Graeme, 2026-09-14): the Employee Records
-- report took minutes because every load re-paginated months of shifts and
-- absences out of Planday's API (50 rows a page, sequential, rate-limited).
-- Attendance history barely changes, so we mirror it here and serve reports
-- from Postgres instantly; only the recent window re-syncs on read, and a
-- date range never fetched before backfills once.
CREATE TABLE IF NOT EXISTS planday_shifts_cache (
  id bigint PRIMARY KEY,          -- Planday shift id
  employee_id bigint,
  shift_type_id bigint,
  position_id bigint,
  date date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_planday_shifts_cache_date ON planday_shifts_cache(date);

CREATE TABLE IF NOT EXISTS planday_absences_cache (
  id bigint PRIMARY KEY,          -- Planday absence record id
  employee_id bigint,
  status text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  record jsonb NOT NULL,          -- raw Planday record (registrations etc.)
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_planday_absences_cache_range ON planday_absences_cache(start_date, end_date);

-- Single-row coverage state: [synced_from, synced_to] is the contiguous
-- date range the mirror holds; fresh_synced_at is the last time the
-- trailing window was re-pulled to catch recent edits.
CREATE TABLE IF NOT EXISTS planday_attendance_sync (
  id integer PRIMARY KEY,
  synced_from date,
  synced_to date,
  fresh_synced_at timestamptz
);
INSERT INTO planday_attendance_sync (id) VALUES (1) ON CONFLICT DO NOTHING;
