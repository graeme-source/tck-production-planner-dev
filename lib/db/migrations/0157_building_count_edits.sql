-- Building station "Edit production numbers" — who changed a recipe's
-- recorded batches / extra packs, when, and from what to what (Graeme,
-- 2026-10-09: builders couldn't take an extra batch back off without an
-- "Undo" that didn't say what it undid). Objectives D (attributed records)
-- and F (trustworthy numbers).
--
-- The numbers themselves stay where they always were: batch_completions
-- rows (one per batch — the run rate counts these) and
-- building_station_progress.extra_packs. This table is the trail behind an
-- edit. Batches ADDED by an edit are also marked on their own row with
-- batch_completions.correction_by_user_id / correction_note.
--
--   batches_* / extra_packs_*  what the builder saw before and saved after
--   removed_completions        the batch rows deleted, as they were:
--                              [{ id, stationType, userId, completedAt, partialPacks }]
--   added_completion_ids       batch rows the edit inserted
--   extras_delta               change to each line's extra_packs, e.g. {"building_1": 2}
--   summary                    the text on the Save button, e.g.
--                              "Batches 6 → 5, Extra packs 0 → 2"
CREATE TABLE IF NOT EXISTS building_count_edits (
  id                   SERIAL PRIMARY KEY,
  plan_id              INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  plan_item_id         INTEGER NOT NULL REFERENCES production_plan_items(id) ON DELETE CASCADE,
  recipe_id            INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  station_type         TEXT NOT NULL,
  user_id              INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  batches_before       INTEGER NOT NULL,
  batches_after        INTEGER NOT NULL,
  extra_packs_before   INTEGER NOT NULL,
  extra_packs_after    INTEGER NOT NULL,
  removed_completions  JSONB NOT NULL DEFAULT '[]'::jsonb,
  added_completion_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  extras_delta         JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary              TEXT NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_building_count_edits_item
  ON building_count_edits (plan_item_id, created_at);
