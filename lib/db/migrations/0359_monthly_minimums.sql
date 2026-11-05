-- A minimum for each month (Graeme, 5 Nov 2026): like the stretch, but a month
-- left blank uses the default rather than the month before. The default goes
-- back to £110,000 and November keeps the £120,000 he set this morning.
-- Objective I.
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS revenue_month_minimums (
  month TEXT PRIMARY KEY CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  minimum_target NUMERIC(12, 2) NOT NULL CHECK (minimum_target > 0),
  set_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  set_by_name TEXT,
  set_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE revenue_target_history DROP CONSTRAINT IF EXISTS revenue_target_history_kind_check;
ALTER TABLE revenue_target_history ADD CONSTRAINT revenue_target_history_kind_check
  CHECK (kind IN ('minimum', 'stretch', 'month_minimum'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM revenue_target_history WHERE kind = 'month_minimum' AND changed_by_name = 'Moved to per-month minimums')
     AND EXISTS (SELECT 1 FROM app_settings WHERE key = 'monthly_revenue_target' AND value::numeric = 120000) THEN
    UPDATE app_settings SET value = '110000', updated_at = NOW() WHERE key = 'monthly_revenue_target';
    INSERT INTO revenue_month_minimums (month, minimum_target, set_by_name) VALUES ('2026-11', 120000, 'Moved to per-month minimums')
      ON CONFLICT (month) DO NOTHING;
    INSERT INTO revenue_target_history (kind, month, old_value, new_value, changed_by_name) VALUES
      ('minimum', NULL, 120000, 110000, 'Moved to per-month minimums'),
      ('month_minimum', '2026-11', NULL, 120000, 'Moved to per-month minimums');
  END IF;
END $$;
