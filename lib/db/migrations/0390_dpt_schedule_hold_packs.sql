-- A scheduled DPT rule can hold a fixed number of PACKS instead of allowing
-- extra batches (Graeme, 20 Nov 2026: Philly off the one-time menu but still
-- the Calzone Club Special — "exactly the right amount plus 5 packs"). With
-- hold_packs set, a plan makes the known orders and leaves exactly that many
-- packs in the fridge, no more; extra_batches is ignored. NULL = batches rule.
-- Objective C. Safe to run twice.

ALTER TABLE dpt_schedules ADD COLUMN IF NOT EXISTS hold_packs INTEGER
  CHECK (hold_packs IS NULL OR (hold_packs >= 0 AND hold_packs <= 500));
