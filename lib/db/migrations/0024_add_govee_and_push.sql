-- Migration: Govee temperature-sensor integration + web-push subscriptions.
--
--  govee_sensors        — one row per Govee thermometer, mapped to a storage
--                         location, caching the latest reading.
--  govee_readings       — append-only reading history for HACCP cold-chain.
--  push_subscriptions   — one row per browser/device a user opted in on, for
--                         web-push alerts.
--
-- Feature toggles, thresholds and alert recipients are stored in app_settings
-- (govee_* keys), not here. Startup migrations in
-- artifacts/api-server/src/index.ts apply these idempotently; this file mirrors
-- the schema in lib/db/src/schema/govee.ts for reference.

CREATE TABLE IF NOT EXISTS govee_sensors (
  id                    SERIAL PRIMARY KEY,
  device                TEXT NOT NULL UNIQUE,
  sku                   TEXT NOT NULL DEFAULT '',
  name                  TEXT NOT NULL DEFAULT '',
  storage_location_id   INTEGER REFERENCES storage_locations(id) ON DELETE SET NULL,
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  last_temperature_c    NUMERIC(5,1),
  last_humidity_percent INTEGER,
  last_online           BOOLEAN,
  last_reading_at       TIMESTAMP,
  created_at            TIMESTAMP NOT NULL DEFAULT now(),
  updated_at            TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS govee_readings (
  id               SERIAL PRIMARY KEY,
  device           TEXT NOT NULL,
  temperature_c    NUMERIC(5,1),
  humidity_percent INTEGER,
  online           BOOLEAN NOT NULL DEFAULT TRUE,
  recorded_at      TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_govee_readings_device_time ON govee_readings (device, recorded_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  user_agent   TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_push_subscriptions_user ON push_subscriptions (user_id);
