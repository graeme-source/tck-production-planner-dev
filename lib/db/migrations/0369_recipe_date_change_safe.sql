-- "Safe to move" (Graeme, 12 Nov 2026): a product we always have in stock
-- (Garlic Mayo) never locks an order's delivery date, even when its recipe is
-- a draft or recently made as test production. Objective C.
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS date_change_safe BOOLEAN NOT NULL DEFAULT FALSE;
