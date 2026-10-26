-- Scheduled DPT rules (Graeme, 26 Oct 2026). Objective C (make what sells,
-- no surplus).
--
-- "Schedule a removal of a recipe ... take it off the one-time menu ... we
-- will keep making it next week, but only a very small amount" — e.g. Philly
-- leaving the one-time menu: from the start date, Create Plan makes its real
-- orders (subscription renewals) plus at most `extra_batches` a day, and the
-- capacity it no longer takes goes to the other recipes. Applied by PLAN
-- date, so a Monday plan made on Thursday already follows Monday's rule.
--
--   starts_on / ends_on  plan dates the rule covers (ends_on NULL = until
--                        it's ended)
--   extra_batches        batches a day allowed above orders + margin
--   ended_at             set when someone ends it early ("End now")

CREATE TABLE IF NOT EXISTS dpt_schedules (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  starts_on DATE NOT NULL,
  ends_on DATE,
  extra_batches INTEGER NOT NULL DEFAULT 2 CHECK (extra_batches >= 0 AND extra_batches <= 50),
  reason TEXT,
  created_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  ended_by_name TEXT
);
CREATE INDEX IF NOT EXISTS dpt_schedules_recipe_idx ON dpt_schedules (recipe_id, starts_on);
