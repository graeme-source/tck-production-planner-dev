-- "Made by hand — prep only" production route (Graeme, 11 Nov 2026).
-- Objective A. A standalone product (the red wine gravy dipping pot) whose
-- ingredients are prepped as normal but which is then made by hand: kept off
-- the dough, sheeting, mixing, building, ovens and wrapping stations. Read
-- through @workspace/production-schedule readRecipeRoute, never by name.
-- Safe to run twice.

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS prep_only BOOLEAN NOT NULL DEFAULT FALSE;
