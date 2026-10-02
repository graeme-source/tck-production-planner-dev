-- Recipe archive (Graeme, 2026-10-02). Objectives A (recipes quick and easy
-- to manage) and F (effortless daily use): the recipe list has grown big
-- with recipes we no longer make. Archiving switches a recipe off — it
-- disappears from the Recipes list and every "choose a recipe" picker — but
-- nothing is deleted: its lines, costs, Shopify mappings, labels and every
-- plan that ever used it stay exactly as they are, and it can be restored
-- at any time.
--
-- archived_at       NULL = active (every existing recipe is unchanged)
-- archived_by_id    who archived it (SET NULL if that user is ever removed)
-- archived_by_name  their name at the time, so the label survives that too
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS archived_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS archived_by_name TEXT;
