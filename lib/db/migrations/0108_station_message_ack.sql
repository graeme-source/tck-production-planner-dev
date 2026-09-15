-- Station messages: optional must-acknowledge mode (Graeme, 2026-09-15).
-- A message sent with requires_ack locks the receiving station's screen
-- behind a full-screen notice until someone there explicitly confirms
-- "I understand and will action this" — for the notes that must not be
-- scrolled past. The existing dismissed_at / dismissed_by_name columns
-- already record who confirmed and when.
ALTER TABLE station_messages ADD COLUMN IF NOT EXISTS requires_ack boolean NOT NULL DEFAULT false;
