-- Connected Inventory (Graeme, 10 Nov 2026). Objective C.
-- Product fridge items bought in and sold on the store (Sauce Shop bottles,
-- Cakehead brownies). When an order goes to their supplier, the Orders page
-- reads each item's Shopify stock and tops it up to its maximum, so one
-- order covers everything and nothing runs short soon after.
--   connected_inventory  true = a product fridge item: stock comes from
--                        Shopify (needs shopify_variant_id)
--   max_stock_units      the most we hold, in store units (bottles, bars)
-- Safe to run twice.

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS connected_inventory BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS max_stock_units INTEGER;
