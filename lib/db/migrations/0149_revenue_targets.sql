-- Monthly revenue targets: a minimum and a stretch (Graeme, 2026-10-08).
-- Objective I (founder command centre — foresight).
--
-- The MINIMUM stays where it has always been: app_settings
-- 'monthly_revenue_target' (one figure, every month). It's re-seeded here
-- (ON CONFLICT DO NOTHING) so a fresh database has it without relying on
-- the startup code. Only the founder may change it — routes/revenue-targets.ts;
-- the generic /api/app-settings route now refuses that key.
--
--   revenue_targets          one row per month that has its OWN stretch
--                            target. A month without a row uses the most
--                            recent earlier month's (carries forward until
--                            changed); no earlier row → no stretch.
--                            Rules: lib/revenue-targets (pure, tested).
--   revenue_target_history   every change, minimum or stretch: who, when,
--                            old → new (new NULL = a month's own stretch
--                            was cleared, so it carries forward again).

INSERT INTO app_settings (key, value, updated_at)
VALUES ('monthly_revenue_target', '120000', NOW())
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS revenue_targets (
  month TEXT PRIMARY KEY CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  stretch_target NUMERIC(12, 2) NOT NULL CHECK (stretch_target > 0),
  set_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  set_by_name TEXT,
  set_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS revenue_target_history (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('minimum', 'stretch')),
  month TEXT CHECK (month IS NULL OR month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  old_value NUMERIC(12, 2),
  new_value NUMERIC(12, 2),
  changed_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  changed_by_name TEXT,
  changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK ((kind = 'minimum') = (month IS NULL))
);

CREATE INDEX IF NOT EXISTS revenue_target_history_changed_at_idx
  ON revenue_target_history (changed_at DESC);
