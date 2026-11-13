-- Local-delivery collections (Graeme, 13 Nov 2026): the supplier whose driver
-- takes our wholesale local-delivery orders (The Best Butcher). Processing a
-- local-delivery wholesale order books a collection on this supplier's
-- delivery for the chosen day, so goods-in can't forget to hand it over.
-- Objective C.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS collects_local_deliveries BOOLEAN NOT NULL DEFAULT FALSE;
