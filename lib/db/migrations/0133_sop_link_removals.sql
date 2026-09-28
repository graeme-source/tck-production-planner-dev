-- A record of every SOP taken off a place (station, page, ingredient,
-- checklist…) — Graeme, 2026-09-28: every user may remove a wrongly attached
-- SOP, but only from inside the SOP itself and after an "Are you sure?", and
-- we want to know who took what off where. Objectives E (standards at the
-- point of use) and F (nothing silently removed).
--
-- Removing a link still deletes the sop_links row (every read path stays as
-- it is), but first copies it here with who and when. The SOP itself is
-- never touched — it stays in the library and can be re-attached, and the
-- app's Undo re-attaches straight from this copy.

CREATE TABLE IF NOT EXISTS sop_link_removals (
  id              SERIAL PRIMARY KEY,
  link_id         INTEGER NOT NULL,
  sop_id          INTEGER NOT NULL REFERENCES standards_sops(id) ON DELETE CASCADE,
  target_type     TEXT NOT NULL,
  target_a        INTEGER,
  target_b        INTEGER,
  target_text     TEXT,
  link_created_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  link_created_at TIMESTAMP,
  removed_by      INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  removed_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_sop_link_removals_sop ON sop_link_removals (sop_id, removed_at DESC);
