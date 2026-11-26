-- A supplier's default "What is this item?" category (Graeme, 26 Nov 2026:
-- "No Fli is always used in subscriptions, so it automatically sets that
-- category for us"). Outstanding transactions from the supplier with no
-- category take it, and an uploaded invoice from them takes it once it's
-- read. Nothing already chosen is ever changed. Objective I. Safe to run twice.
ALTER TABLE fin_vendors ADD COLUMN IF NOT EXISTS default_category_id INTEGER REFERENCES fin_categories(id) ON DELETE SET NULL;
