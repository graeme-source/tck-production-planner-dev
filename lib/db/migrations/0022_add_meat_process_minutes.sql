-- Per-raw-meat total lead time (cook + processing + buffer) in minutes, used by
-- the production-schedule timeline to compute each recipe's "get the meat in by"
-- time. Applied idempotently at startup in artifacts/api-server/src/index.ts.
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS meat_process_minutes integer;

-- Forward-planning settings for the day schedule.
INSERT INTO app_settings (key, value, updated_at) VALUES
  ('building_start_time', '07:00', NOW()),
  ('changeover_seconds', '90', NOW())
ON CONFLICT (key) DO NOTHING;

-- Lunch allowance corrected 45 -> 35 (one-time; admins can re-edit afterwards).
-- Guarded by _migrations_done so it never clobbers a later manual change.
CREATE TABLE IF NOT EXISTS _migrations_done (key TEXT PRIMARY KEY, done_at TIMESTAMP DEFAULT NOW());
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migrations_done WHERE key = 'default_lunch_minutes_35_v1') THEN
    INSERT INTO app_settings (key, value, updated_at)
    SELECT 'default_lunch_minutes', '35', NOW()
    WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'default_lunch_minutes');
    UPDATE app_settings SET value = '35', updated_at = NOW() WHERE key = 'default_lunch_minutes';
    INSERT INTO _migrations_done (key) VALUES ('default_lunch_minutes_35_v1');
  END IF;
END $$;
