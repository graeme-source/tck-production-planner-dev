-- Team efficiency KPI (Graeme, 2026-09-25: "an analytics section in the KPIs
-- bit ... a line graph that shows me what we've been doing over recent
-- times ... backdate it ... 12 months"). Objective I, feeding E/G.
--
-- One row per production day, written by the nightly job (and a one-off
-- backfill on first boot). The raw components (packs and RRP value per line,
-- labour cost) are stored so a change to a founder setting restates history
-- without going back to Planday; the derived columns are rewritten whenever
-- a setting changes.
--
-- CONFIDENTIAL: value_* , labour_cost, line_labour, paid_hours and ratio are
-- the founder's alone — the API strips them for everyone else. No
-- individual's pay is ever stored here, only whole-day totals.
CREATE TABLE IF NOT EXISTS team_efficiency_days (
  date                 date PRIMARY KEY,
  -- raw components
  made                 jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { [line]: { packs, gross, bags, bagGross, plannedBatches, fromBatches } }
  despatched           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { [line]: { packs, gross, bagPacks, bagGross } }
  orders_despatched    integer NOT NULL DEFAULT 0,
  labour_cost_total    numeric(12,2) NOT NULL DEFAULT 0,    -- productive pay x on-cost, before line removal
  line_labour          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { [line]: on-cost labour of line-only positions }
  paid_hours           numeric(8,2) NOT NULL DEFAULT 0,
  headcount            integer NOT NULL DEFAULT 0,
  pending_shifts       integer NOT NULL DEFAULT 0,
  ignored_unapproved   integer NOT NULL DEFAULT 0,
  -- derived (restated when settings change)
  packs_by_line        jsonb NOT NULL DEFAULT '{}'::jsonb,
  eight_pack_bags      integer NOT NULL DEFAULT 0,
  packs_despatched     integer NOT NULL DEFAULT 0,
  value_made_net       numeric(12,2) NOT NULL DEFAULT 0,
  value_despatched_net numeric(12,2) NOT NULL DEFAULT 0,
  value_credited       numeric(12,2) NOT NULL DEFAULT 0,
  labour_cost          numeric(12,2) NOT NULL DEFAULT 0,
  ratio                numeric(8,4),
  efficiency_pct       numeric(7,2),
  status               text NOT NULL DEFAULT 'pending',     -- ok | pending | excluded | no_labour
  flags                jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at          timestamptz NOT NULL DEFAULT now()
);

-- Founder-editable settings, key -> json value. Seeded with the back-test's
-- figures (2026-09-25). Discount rates are per recipe category, as data.
CREATE TABLE IF NOT EXISTS team_efficiency_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer
);

INSERT INTO team_efficiency_settings (key, value) VALUES
  -- Median daily R since 24 Aug 2026. FIXED: it does not roll.
  ('standard',           '{"ratio": 4.78, "setOn": "2026-09-25"}'::jsonb),
  ('despatch_share',     '0.11'::jsonb),
  ('discount_rates',     '{"Calzones": 0.22, "Macaroni Cheese": 0.039, "Fried Chicken": 0.051, "Desserts": 0.023}'::jsonb),
  ('eight_pack_factor',  '0.72'::jsonb),
  -- Staff who only ever work one line: their pay comes off a day that line
  -- wasn't in the planner (fried chicken runs before it was planned).
  ('line_positions',     '{"Fried Chicken": ["Frying", "Breading"]}'::jsonb),
  ('holiday_accrual',    '0.1207'::jsonb),
  ('production_section', '"Production"'::jsonb)
ON CONFLICT (key) DO NOTHING;
