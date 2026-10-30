-- Queued test production → the Orders page (Graeme, 30 Oct 2026). "Order
-- now" used to create and PLACE purchase orders straight into Deliveries,
-- skipping the real ordering (nothing reached the suppliers). Now it puts the
-- ingredients on today's supplier cards, like a pulled kanban, to be ordered
-- with the normal orders: mark 'queued' with the packs and supplier. Placing
-- that supplier's order turns it to 'ordered' (po_id). "Not today" on the
-- card clears it back onto the test list. Objective B.

ALTER TABLE queued_ingredient_marks DROP CONSTRAINT IF EXISTS queued_ingredient_marks_mark_check;
ALTER TABLE queued_ingredient_marks ADD CONSTRAINT queued_ingredient_marks_mark_check
  CHECK (mark IN ('ordered', 'not_needed', 'queued'));
ALTER TABLE queued_ingredient_marks ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE queued_ingredient_marks ADD COLUMN IF NOT EXISTS packs INTEGER;
