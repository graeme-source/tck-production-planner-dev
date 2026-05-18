-- Migration: Label recipes — hidden flag
--
-- Adds a hidden flag to label_recipes so users can remove a real recipe
-- from the calculator without it being auto-re-added on the next GET.
-- Misc rows still actual-delete (no chance of auto-recreation); real rows
-- flip hidden=true instead. Re-adding the same recipe via "Add from menu"
-- un-hides the existing row rather than creating a duplicate.

ALTER TABLE label_recipes
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ix_label_recipes_hidden
  ON label_recipes (hidden);
