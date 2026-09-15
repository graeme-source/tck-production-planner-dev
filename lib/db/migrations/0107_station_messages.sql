-- Station messages (Graeme, 2026-09-15): anyone can send a note to a
-- station ("packing: the Mursley order gets collected at 2 today") and it
-- shows as a banner on that station's screen until someone there dismisses
-- it. Station screens are shared devices, so dismissal is per message, not
-- per user.
CREATE TABLE IF NOT EXISTS station_messages (
  id serial PRIMARY KEY,
  station_type text NOT NULL,
  body text NOT NULL,
  created_by_user_id integer REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  dismissed_by_name text
);
CREATE INDEX IF NOT EXISTS idx_station_messages_open ON station_messages(station_type, created_at) WHERE dismissed_at IS NULL;
