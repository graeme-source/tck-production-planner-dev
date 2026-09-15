-- Ticks for LINKED prep rows — derived tasks that aren't recipe ingredients
-- (the first: pasta cooking water and salt on the mac-cheese main prep).
-- They were display-only sub-rows, which made them the only prep work on the
-- screen that couldn't be ticked off (Graeme, 2026-09-09). prep_completions
-- can't hold them (ingredient_id/recipe_id shaped), so they get their own
-- tiny table keyed by a stable text key per plan.
CREATE TABLE IF NOT EXISTS prep_linked_completions (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  -- e.g. 'pasta_water:123' — stable per linked task, minted by the server
  -- where the linked row itself is built.
  linked_key TEXT NOT NULL,
  user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  completed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, linked_key)
);
