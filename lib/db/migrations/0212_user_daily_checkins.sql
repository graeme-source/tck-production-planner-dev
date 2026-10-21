-- Daily improvement check-in (Graeme, 21 Oct 2026). Objectives E and H.
--
-- "When any person logs in for the first time each day, give them a review
-- of their improvement score and encourage them to find just one small
-- improvement today. They have to acknowledge it before they can do
-- anything else in the app."
--
-- One row per person per London calendar day, written when they tap
-- "Got it" (or "Log an improvement now"). The card is due when there is no
-- row for today — so once acknowledged it stays away on EVERY device until
-- the next London day, whether they signed in with a password or unlocked a
-- shared iPad with their PIN.
--
-- A small table rather than one date column on app_users: it keeps a
-- history (who is seeing the card, and what score they were shown that
-- day, so we can later tell whether the nudge moves scores), and the
-- (user_id, day) key makes a double tap or two devices acknowledging at
-- once harmless (ON CONFLICT DO NOTHING).
CREATE TABLE IF NOT EXISTS user_daily_checkins (
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- What the card showed: the score % (NULL = no score, e.g. not linked to
  -- Planday) and the 30-day credits.
  score_shown INTEGER,
  credits_shown INTEGER,
  -- 'got_it' or 'log_now' — which button they pressed.
  choice TEXT NOT NULL DEFAULT 'got_it',
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS user_daily_checkins_day_idx ON user_daily_checkins (day);
