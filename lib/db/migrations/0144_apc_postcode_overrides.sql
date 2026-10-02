-- APC postcode overrides (Graeme, 2026-10-02). Objective D (despatch).
--
-- APC's POSTINFO table (src/data/apc-postinfo.csv) says what each postcode
-- normally gets. When APC refuse a service the table lists (KA3, depot 274:
-- Saturday by 10:30, yet "NO Services available"), the packer calls APC
-- customer service and records the answer here:
--   permanent  — APC confirmed the service is gone: the postcode check now
--                shows it as NOT available, everywhere the check is shown.
--   temporary  — still listed, but flagged; expires automatically after
--                TEMPORARY_RESTRICTION_DAYS (services/apc-postcode-overrides.ts)
--                or when someone clears it.
-- Keyed on the outward code the table row was matched on (e.g. 'KA3').
-- Never hard-deleted: clearing sets cleared_at/by, so the history stays.
CREATE TABLE IF NOT EXISTS apc_postcode_overrides (
  id                SERIAL PRIMARY KEY,
  outward           TEXT NOT NULL,
  service           TEXT NOT NULL CHECK (service IN ('saturday', 'weekday')),
  kind              TEXT NOT NULL CHECK (kind IN ('temporary', 'permanent')),
  note              TEXT,
  depot             TEXT,
  recorded_by_id    INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  recorded_by_name  TEXT,
  recorded_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  cleared_at        TIMESTAMP,
  cleared_by_id     INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  cleared_by_name   TEXT
);
CREATE INDEX IF NOT EXISTS ix_apc_postcode_overrides_live
  ON apc_postcode_overrides (outward, service) WHERE cleared_at IS NULL;
