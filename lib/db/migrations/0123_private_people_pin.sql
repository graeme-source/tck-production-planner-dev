-- Private PIN for the People section (Graeme, 2026-09-24).
--
-- Graeme sometimes has to type his PIN in front of others at a station.
-- That PIN also opened the People section (employee records, reviews,
-- return-to-work forms). He can now set a SECOND, private PIN used only by
-- the People gate. Station logins and idle unlocks keep the normal PIN and
-- no longer open People once a private PIN exists.
--
-- Opt-in per person: NULL = no private PIN, behaviour exactly as before.
-- Separate attempt counter and lockout so a wrong People PIN can never lock
-- someone out of their station, or vice versa.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS private_pin_hash TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS private_pin_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS private_pin_locked_until TIMESTAMP;
