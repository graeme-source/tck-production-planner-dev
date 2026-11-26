-- Orders with no delivery (Graeme, 26 Nov 2026: the used oil collection
-- "isn't something that gets delivered … a collection that happens
-- independent of us … we do want to still recognise and record the fact
-- that we've placed the order. We don't want it to go onto the deliveries
-- page"). An ingredient can be marked No delivery; an order holding only
-- such items is marked no_delivery when it's placed — it counts as ordered
-- everywhere, but never shows on Deliveries or waits to be received.
-- Objective C. Safe to run twice.
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS no_delivery BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS no_delivery BOOLEAN NOT NULL DEFAULT false;
