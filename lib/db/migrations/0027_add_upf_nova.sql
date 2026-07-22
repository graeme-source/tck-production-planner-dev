-- Migration: Ingredients — NOVA / UPF classification
--
-- Adds per-ingredient NOVA processing classification (1-4) so recipes and
-- sub-recipes can roll up a UPF percentage by weight. NOVA 4 = ultra-
-- processed food (UPF). Null nova_class = not yet classified (or not a
-- food item — cleaning/packaging ingredients are never classified).
--
--   nova_class       1 unprocessed/minimally processed, 2 processed
--                    culinary ingredient, 3 processed food, 4 UPF
--   nova_markers     jsonb array of the specific UPF marker ingredients
--                    found in the label declaration (e.g. "glucose-fructose
--                    syrup", "modified maize starch", "flavourings") —
--                    drives the "why is this UPF" display
--   nova_reasoning   one/two-line explanation from the analysis
--   nova_confidence  high | medium | low — low usually means no label
--                    declaration was available and the class was estimated
--                    from the name alone
--   nova_source      'ai' or 'manual' — manual wins; the batch analyzer
--                    never overwrites a manual classification
--   nova_analyzed_at when the classification was last set

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS nova_class integer,
  ADD COLUMN IF NOT EXISTS nova_markers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS nova_reasoning text,
  ADD COLUMN IF NOT EXISTS nova_confidence text,
  ADD COLUMN IF NOT EXISTS nova_source text,
  ADD COLUMN IF NOT EXISTS nova_analyzed_at timestamp;
