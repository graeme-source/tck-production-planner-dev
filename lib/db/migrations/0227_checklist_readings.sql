-- Checklist readings (issues #87 and #169, approved 2026-10-22). Objective D
-- (HACCP compliance and SALSA-ready records).
--
-- "Please can we add the scale calibration spreadsheet to this app for
-- Monday checks" (Kerri-Leigh). Building 1's Monday 'Calibrate scales' tick
-- said it was done but not WHAT the scales read. Any checklist item can now
-- ask for a reading: a number + unit, saved with who and when, and listed in
-- Analytics -> HACCP -> Readings & Cook-Chill.
--
--   checklist_templates.reading_unit    NULL = a plain tick (every existing
--       item). Set (e.g. 'g', '°C') = the item asks for a reading.
--   checklist_templates.reading_labels  One reading per label, e.g.
--       {'Scale 1','Scale 2','Prep scale'}. NULL/empty = one unlabelled reading.
--   checklist_templates.reading_min / reading_max  Optional pass range
--       (e.g. 999 to 1001 for a 1 kg test weight). NULL = no limit that side.
--
--   checklist_readings  One row per (item, plan, label). Re-entering a
--       reading (a typo) updates the row and re-stamps who/when. The pass
--       range in force is copied onto the row so a later edit to the item
--       never rewrites an old verdict.
--
-- Additive only; idempotent. No data is changed.

ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS reading_unit TEXT;
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS reading_labels TEXT[];
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS reading_min NUMERIC(10, 2);
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS reading_max NUMERIC(10, 2);

CREATE TABLE IF NOT EXISTS checklist_readings (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  station_type TEXT NOT NULL,
  -- '' = the item's single unlabelled reading.
  label TEXT NOT NULL DEFAULT '',
  value NUMERIC(10, 2) NOT NULL,
  unit TEXT NOT NULL,
  expected_min NUMERIC(10, 2),
  expected_max NUMERIC(10, 2),
  -- NULL = no pass range set on the item when it was recorded.
  in_range BOOLEAN,
  recorded_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  recorded_by_name TEXT NOT NULL,
  recorded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_checklist_reading UNIQUE (template_id, plan_id, label)
);

CREATE INDEX IF NOT EXISTS checklist_readings_recorded_at_idx ON checklist_readings (recorded_at);
