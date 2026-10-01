-- Defects (Graeme, 2026-10-01). Objectives E (defects recorded where they
-- happen, so they can be reduced) and F (every record attributed and kept).
--
-- On 30 Sep 2026 a tray of 8 calzones was wrapped and labelled as a
-- different recipe and despatched. A defect is any process not carried out
-- correctly that ends in product not acceptable for normal despatch.
--
-- Wonkies and dog bins are already defects and are already counted per tap
-- (production_plan_items.wonly_total / dog_bin_count, migration 0131). They
-- are NOT re-entered here — the Defects KPI adds them automatically. This
-- table holds every OTHER defect, usually recorded after the fact (a
-- customer complaint the next day, a mislabel found on despatch).
--
-- 1) defect_types — the kinds of recorded defect. Data, not code: admins
--    add, rename and switch them off on the Defects page. Never hard-deleted
--    (old records keep their type); "active = false" hides it from the
--    record form.
CREATE TABLE IF NOT EXISTS defect_types (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_defect_types_name ON defect_types (lower(name));

INSERT INTO defect_types (name, sort_order) VALUES
  ('Mislabel', 10),
  ('Wrong or missing item in order', 20),
  ('Damaged / leaking pack', 30),
  ('Customer quality complaint', 40)
ON CONFLICT DO NOTHING;

-- 2) defects — one recorded defect.
--    occurred_on  the London calendar day it happened (may be in the past)
--    packs        how many packs were affected (≥ 1)
--    station      where it went wrong: a station key the app already uses
--                 (wrapping, packing, …) or short free text; NULL = not known
--    order_refs   free text, e.g. "#136117, #136112"
--    Soft delete only (deleted_at), so a mistaken delete can be traced.
CREATE TABLE IF NOT EXISTS defects (
  id                SERIAL PRIMARY KEY,
  occurred_on       DATE NOT NULL,
  defect_type_id    INTEGER NOT NULL REFERENCES defect_types(id),
  recipe_id         INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  packs             INTEGER NOT NULL DEFAULT 1 CHECK (packs >= 1),
  station           TEXT,
  order_refs        TEXT,
  note              TEXT,
  recorded_by_id    INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  recorded_by_name  TEXT,
  updated_by_id     INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_name   TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMP,
  deleted_by_id     INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  deleted_by_name   TEXT
);
CREATE INDEX IF NOT EXISTS ix_defects_occurred_on ON defects (occurred_on) WHERE deleted_at IS NULL;
