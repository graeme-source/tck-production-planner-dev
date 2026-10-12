-- Dough Prep mix progress, saved (Graeme, 2026-10-12). Objective C.
--
-- The Dough Prep station's per-mix ingredient ticks and "Mix N complete"
-- lived only in the iPad's memory. A reload, or a second iPad, showed
-- "0 of 2 mixes done" with every ingredient unticked, even after the team
-- had mixed both and balled all 110 balls (12 Oct) — so Graeme thought the
-- dough hadn't been made.
--
-- One row per mix of a plan's day-before dough. plan_id is the TRACKING
-- plan: the production plan the dough is FOR (the next day's plan), the
-- same plan the dough_prep batch_completions (balls) are recorded against.
--
--   ticks  { "<ingredientKey>": { "at": "<ISO time>", "by": <app_users.id> } }
--          ingredientKey = the ingredient id as text, or its name when the
--          dough line has no ingredient id (matches the station screen).
--          Each tick/untick is applied as its own atomic jsonb change, so
--          two iPads ticking at once never overwrite each other.
--   completed_at / completed_by_user_id — "Mix N complete" (NULL = not yet).
--   updated_at / updated_by_user_id     — last change of any kind.
--
-- Read/write: routes/dough-mix-progress.ts. Nothing is derived from it
-- elsewhere — balls stay in batch_completions.
CREATE TABLE IF NOT EXISTS dough_mix_progress (
  plan_id               INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  mix_no                INTEGER NOT NULL CHECK (mix_no >= 1),
  ticks                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at          TIMESTAMP,
  completed_by_user_id  INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by_user_id    INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  PRIMARY KEY (plan_id, mix_no)
);
