-- Migration: Prep deferrals
--
-- Records when a prep tin is intentionally pushed from its scheduled prep
-- session to a later date — used for items with short post-open shelf life
-- (e.g. milk/cream for mac cheese sauce) that can't be opened on Friday for
-- a Monday production because they'd expire over the weekend.
--
-- A deferral is independent of completion: prep_completions remains the
-- single source of truth for "is this tin done". The presence of a
-- prep_deferrals row marks the tin as deferred (counts as resolved for the
-- source-day % complete, and surfaces in a "Deferred prep" banner on the
-- target date). When the tin is later ticked off on the target date it
-- gets a normal prep_completions row inserted via the usual endpoint —
-- the deferral row stays as audit trail.
--
-- Mirrors the partial-unique pattern used by prep_completions so a tin
-- can be uniquely identified whether it came from a base ingredient or
-- an expanded sub-recipe.

CREATE TABLE IF NOT EXISTS prep_deferrals (
  id serial PRIMARY KEY,
  plan_id integer NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  ingredient_id integer REFERENCES ingredients(id) ON DELETE CASCADE,
  sub_recipe_id integer REFERENCES sub_recipes(id),
  recipe_id integer NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tin_number integer NOT NULL,
  deferred_to_date date NOT NULL,
  user_id integer REFERENCES app_users(id) ON DELETE SET NULL,
  deferred_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_prep_deferral_ing
  ON prep_deferrals (plan_id, ingredient_id, COALESCE(sub_recipe_id, 0), recipe_id, tin_number)
  WHERE ingredient_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_prep_deferral_sub
  ON prep_deferrals (plan_id, sub_recipe_id, recipe_id, tin_number)
  WHERE sub_recipe_id IS NOT NULL AND ingredient_id IS NULL;

CREATE INDEX IF NOT EXISTS ix_prep_deferral_target
  ON prep_deferrals (deferred_to_date);
