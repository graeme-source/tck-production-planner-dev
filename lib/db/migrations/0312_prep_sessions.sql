-- Prep sessions — how long prep really takes (Graeme, 27 Oct 2026).
-- Objectives C (production) and I (business decisions).
--
-- "You should be able to see how long it takes, roughly… from when someone
-- opens a prep item to when they complete it." Prep completions already
-- record WHEN a tin was ticked; nothing recorded when the item was OPENED,
-- so durations could not be measured. These two tables add that, invisibly:
-- the prep screens write them in the background (routes/prep-sessions.ts)
-- and Analytics → Prep times reads them (routes/prep-times.ts). The rules —
-- when a re-open continues a session, which session a tick belongs to, and
-- how durations are cleaned — are pure and tested in the api-server's
-- lib/prep-session-rules.ts and lib/prep-timing.ts.
--
-- prep_sessions: one row per person working one prep item.
--   plan_id          the plan the screen was prepping for
--   station          the screen it was opened on (main_prep, prep_bases,
--                    prep_meat) — context only
--   ingredient_id /  the prep item; exactly one is set (a sub-recipe for
--   sub_recipe_id    Garlic Butter, Tomato Base, a rub…)
--   recipe_id        set when the screen opens the item for ONE recipe (Raw
--                    Meat opens a recipe's meat); NULL when the item is
--                    opened across every recipe that uses it (Main Prep)
--   user_id          who opened it (the PIN-signed-in person)
--   device_id        a random id per browser, to tell two iPads apart
--   opened_at        first opened
--   closed_at        when the person last moved off it (another item, left
--                    the screen); NULL while open. closed_at set with
--                    completed_at NULL = closed without completing anything
--   completed_at     time of its latest completion; NULL = nothing completed
--   quantity /       total prepared in the session — the sum of its
--   quantity_unit    completions, in the unit the screen showed
--   pauses           [{"from": ms, "to": ms}] — closed, then re-opened
--                    within 15 minutes and continued: the gap is not prep
--
-- prep_session_completions: what completed a session. One row per prep tick,
-- linked to the existing prep_completions row (and deleted with it when the
-- tick is undone), or one row per finished sub-recipe make flow (no
-- prep_completions row; batches = mixes made).
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS prep_sessions (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  station TEXT NOT NULL,
  ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE CASCADE,
  sub_recipe_id INTEGER REFERENCES sub_recipes(id) ON DELETE CASCADE,
  recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  device_id TEXT,
  opened_at TIMESTAMP NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMP,
  completed_at TIMESTAMP,
  quantity NUMERIC(14, 4),
  quantity_unit TEXT,
  pauses JSONB NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT prep_sessions_one_item CHECK (num_nonnulls(ingredient_id, sub_recipe_id) = 1)
);

-- "This person's latest session on this item" — every open and tick asks it.
CREATE INDEX IF NOT EXISTS idx_prep_sessions_user_plan
  ON prep_sessions (user_id, plan_id, opened_at DESC);
-- The report's date window.
CREATE INDEX IF NOT EXISTS idx_prep_sessions_opened_at
  ON prep_sessions (opened_at);

CREATE TABLE IF NOT EXISTS prep_session_completions (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES prep_sessions(id) ON DELETE CASCADE,
  prep_completion_id INTEGER UNIQUE REFERENCES prep_completions(id) ON DELETE CASCADE,
  recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  quantity NUMERIC(14, 4),
  quantity_unit TEXT,
  batches NUMERIC(10, 3),
  completed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prep_session_completions_session
  ON prep_session_completions (session_id);
