-- Self-correcting prep-oven timings (Graeme, 27 Oct 2026). Objectives C, D, G.
--
-- Per hot raw meat the schedule targets
--     OUT of the oven at = builders need it − PROCESSING − BUFFER
--     IN  the oven at    = out − COOK
-- COOK stays as configured (food safety — never changed). PROCESSING and
-- BUFFER are learned daily from the floor.
--
--   ingredients.meat_buffer_minutes  The learned cover so builder waits are
--       rare: the smallest that keeps them rare, from how wrong the
--       builders' predicted time has been and how much processing varies.
--       NULL = 5 (start small).
--   ingredients.meat_timing_auto_learn  TRUE (default): the daily run may move
--       processing and buffer. A manager reverting a change turns it off.
--
--   meat_timing_adjustments  One row per change to processing or buffer —
--       automatic, by hand, or a revert: old → new, why, the runs and the
--       processing spread it was based on. Cook time is never in here.
--
--   meat_put_in_records  The daily review: one row per raw meat × recipe ×
--       plan, created when its FIRST tray goes into the prep oven.
--       suggested_at_minutes   the "in the oven by" the station showed then;
--       predicted_need_minutes when the live schedule then expected the
--                              builders to need it (the buffer learns from
--                              how wrong this was);
--       deviation_minutes      put-in − suggested (+ = late);
--       reason_*               the quick-pick "why?" when off-time.
--     Filled in by the daily review:
--       out_at_minutes         first tray out cooked (probe reading preferred);
--       ready_at_minutes       first tin of the filling mixed;
--       needed_at_minutes      when the builders were free for the recipe;
--       sat_minutes / wait_minutes / cost_minutes (sat + 4 × wait);
--       last_built_minutes, safety_minutes, safety_breach  — the 4-hour rule:
--           out → last batch built + baked + chilled to 8 °C ≤ 240;
--       outcome 'perfect' | 'builders_waited' | 'too_early' | 'unknown';
--       cause   'none' | 'model' | 'human' | 'capacity' | 'unknown'.
--
-- Settings (app_settings), only if not already set:
--   meat_timing_learning_enabled  'true'
--   meat_safe_total_minutes       240 — out of the prep oven → last batch
--                                 chilled to 8 °C
--   calzone_chill_minutes         120 — baked calzones to 8 °C, used when
--                                 there's no probe reading or plausible tap
--   (calzone_bake_minutes         optional; unset = learned from the ovens)
--   builder_wait_weight           4 — a minute of builder wait costs 4 of sitting
--   meat_buffer_max_minutes       25 — cap on the learned buffer
--   meat_put_in_reason_minutes    10 — ask why beyond this (+ loading time)
--
-- Additive only; idempotent. No existing values are changed.

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS meat_buffer_minutes INTEGER;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS meat_timing_auto_learn BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS meat_timing_adjustments (
  id SERIAL PRIMARY KEY,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  -- Copied so the log reads right after a rename.
  ingredient_name TEXT NOT NULL,
  field TEXT NOT NULL CHECK (field IN ('process', 'buffer')),
  old_value INTEGER,
  new_value INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('auto', 'manual', 'revert')),
  reason TEXT NOT NULL,
  runs_used INTEGER,
  process_median_minutes NUMERIC(7, 1),
  process_slow_minutes NUMERIC(7, 1),
  actor_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  actor_name TEXT,
  reverted_at TIMESTAMPTZ,
  reverted_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS meat_timing_adjustments_ingredient_idx
  ON meat_timing_adjustments (ingredient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS meat_put_in_records (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  plan_date DATE NOT NULL,
  recipe_id INTEGER NOT NULL,
  recipe_name TEXT NOT NULL,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  ingredient_name TEXT NOT NULL,
  suggested_at_minutes INTEGER,
  planned_at_minutes INTEGER,
  predicted_need_minutes INTEGER,
  lead_minutes INTEGER,
  -- Trays of this meat: loading takes time, so the put-in tolerance widens.
  tray_count INTEGER,
  put_in_at TIMESTAMPTZ NOT NULL,
  put_in_minutes INTEGER NOT NULL,
  deviation_minutes INTEGER,
  reason_code TEXT,
  reason_note TEXT,
  reason_by_name TEXT,
  reason_at TIMESTAMPTZ,
  out_at_minutes INTEGER,
  ready_at_minutes INTEGER,
  needed_at_minutes INTEGER,
  buffer_minutes INTEGER,
  outcome TEXT,
  cause TEXT,
  followed BOOLEAN,
  wait_minutes INTEGER,
  sat_minutes INTEGER,
  cost_minutes INTEGER,
  last_built_minutes INTEGER,
  safety_minutes INTEGER,
  safety_breach BOOLEAN,
  -- Where the chill time came from: 'probe' (measured), 'tap' (a plausible
  -- "mark as chilled"), or 'default' (Settings). Probe/tap = measured.
  chill_source TEXT,
  chill_minutes INTEGER,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, recipe_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS meat_put_in_records_ingredient_idx
  ON meat_put_in_records (ingredient_id, plan_date DESC);

-- Continuous temperature probes (Graeme, 27 Oct 2026: Inkbird probes on the
-- chilling calzones, "register a particular probe to a particular recipe on
-- any given day, and see 'that got down to 8° at this time'"). Readings come
-- in from a small bridge on a factory computer (POST /api/probe-readings,
-- PROBE_BRIDGE_TOKEN bearer), like the print bridge.
--   probe_readings     every reading: probe, when, °C (whole degrees on the
--                      INT-11P-B). One row per probe per instant.
--   probe_assignments  which probe is on which recipe on which plan (day),
--                      and for what ('chill' today).
CREATE TABLE IF NOT EXISTS probe_readings (
  id BIGSERIAL PRIMARY KEY,
  probe_id TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  temp_c NUMERIC(5, 1) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (probe_id, recorded_at)
);
CREATE INDEX IF NOT EXISTS probe_readings_probe_time_idx ON probe_readings (probe_id, recorded_at);

CREATE TABLE IF NOT EXISTS probe_assignments (
  id SERIAL PRIMARY KEY,
  probe_id TEXT NOT NULL,
  plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  recipe_id INTEGER NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'chill' CHECK (purpose IN ('chill')),
  assigned_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (probe_id, plan_id, purpose)
);
CREATE INDEX IF NOT EXISTS probe_assignments_plan_recipe_idx ON probe_assignments (plan_id, recipe_id);

INSERT INTO app_settings (key, value) VALUES
  ('meat_timing_learning_enabled', 'true'),
  ('meat_safe_total_minutes', '240'),
  ('calzone_chill_minutes', '120'),
  ('builder_wait_weight', '4'),
  ('meat_buffer_max_minutes', '25'),
  ('meat_put_in_reason_minutes', '10')
ON CONFLICT (key) DO NOTHING;
