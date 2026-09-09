-- Supplier-level switch: some suppliers (Amazon and the like) never hand
-- over an invoice or delivery note — everything is tracked in their own
-- systems. For those, the "Invoice filed" step on goods-in is noise that
-- either blocks fully-processed status or trains people to tick lies.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS invoice_not_required BOOLEAN NOT NULL DEFAULT FALSE;
