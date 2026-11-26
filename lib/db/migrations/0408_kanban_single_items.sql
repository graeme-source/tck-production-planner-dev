-- Kanban in single items (Graeme, 26 Nov 2026 — pepperoni): the supplier
-- sells boxes of 10 bags, but once the box is opened the bags go into the
-- two-bin system, so the card should say "Pull when 15 bags left" while the
-- Orders page still says "order 3 boxes (30 kg)". kanban_item_name is what
-- one item is called (bag, tub …), kanban_items_per_pack how many are in one
-- supplier pack. Both null = off. Display only: the pull-at figure is still
-- stored in packs, so ordering and stock-left maths don't change.
-- Objective C. Safe to run twice.
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS kanban_item_name TEXT;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS kanban_items_per_pack INTEGER;
