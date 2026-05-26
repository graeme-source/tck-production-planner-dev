-- Migration: Ingredients — AI-estimated nutritionals flag
--
-- Adds a boolean to mark ingredients whose per-100g nutritional values
-- came from the name-only AI estimate flow (no supplier URL — Claude
-- guessed from the name + category). The form shows a ✨ chip on the
-- Nutritionals section header when this is true so operators know
-- the numbers haven't been verified against a supplier label.
--
-- Cleared back to false when an operator edits any nutritional field
-- manually after the AI fill (handled in the form layer, not here).

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS nutritionals_ai_estimated boolean NOT NULL DEFAULT false;
