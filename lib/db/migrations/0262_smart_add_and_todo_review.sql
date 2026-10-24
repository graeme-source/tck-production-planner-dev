-- Smart add + the 8am to-do review (Graeme, 24 Oct 2026). Objective E.
--
-- "I can write 'clean packing computer every Thursday' ... and it will add
-- it" — one add box for team lists, personal to-dos and station checklists.
-- Team lists and checklists already repeat; personal to-dos now can too:
--
--   todo_tasks.recurrence   a lib/recurrence RecurrenceRule (NULL = one-off).
--                           Ticking a repeating to-do off creates the next
--                           one on its next due day.
--   todo_tasks.time_of_day  "HH:MM" London, NULL = any time.
--
-- "A daily, unmissable task that pops up at 8 am every day to force me to
-- review my to-do list." One row per person who has it switched on:
--
--   enabled           the 8am review takes over the screen
--   last_reviewed_on  London date it was last finished (once a day)
--   snoozed_until     "Not now" pushes it back; it comes back after this

ALTER TABLE todo_tasks ADD COLUMN IF NOT EXISTS recurrence JSONB;
ALTER TABLE todo_tasks ADD COLUMN IF NOT EXISTS time_of_day TEXT;

CREATE TABLE IF NOT EXISTS todo_review_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_reviewed_on DATE,
  snoozed_until TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Graeme asked for it, so it starts on for him.
INSERT INTO todo_review_prefs (user_id, enabled)
SELECT id, TRUE FROM app_users WHERE lower(email) = 'graeme@thecalzonekitchen.co.uk'
ON CONFLICT (user_id) DO NOTHING;
