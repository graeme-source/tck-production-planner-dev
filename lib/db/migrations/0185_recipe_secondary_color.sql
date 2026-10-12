-- Recipe secondary colour (Graeme, 2026-10-12): "Can we add a secondary
-- colour for each recipe? … I want two, so we can have red and yellow or red
-- and orange, so I can give more granular identity to each recipe."
-- Objectives A and F.
--
--   • recipes.secondary_color — optional second hex colour beside the
--     existing recipes.color. NULL = single colour, everything shows exactly
--     as before. Nothing is copied or changed on existing rows.
--
-- Idempotent: re-running changes nothing.

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS secondary_color TEXT;
