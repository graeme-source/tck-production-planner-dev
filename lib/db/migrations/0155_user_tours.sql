-- One-off guided walkthroughs, remembered per PERSON (Graeme, 2026-10-09).
-- Objectives H (a personal experience) and F (people know how the app works).
--
-- The first is "swipe_panel": the orange quick-actions tab on the right now
-- swipes out into a full panel, and everyone is shown how once. Stored on
-- the server so it follows the person across devices; on a shared station
-- iPad it is whoever is signed in (a PIN switch changes the session user).
-- "Show me later" is session-only on the device and writes nothing here.
CREATE TABLE IF NOT EXISTS user_tours (
  user_id       INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  tour_key      TEXT NOT NULL,
  completed_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, tour_key)
);
