-- Suppliers we order from by email (Graeme, 4 Nov 2026): the Orders card's main
-- button becomes Email order instead of Supplier website. Off for everyone,
-- then on for the four he named. Change it on the supplier's record.
-- Objective C.
--
-- Safe to run twice.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS order_by_email BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE suppliers
   SET order_by_email = TRUE
 WHERE trim(name) ILIKE ANY (ARRAY['Macfarlane%', 'McFarlane%', 'Puffin%', 'Thergis%', 'A D Maria%', 'AD Maria%']);
