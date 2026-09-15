-- "Checked it — quiet until tomorrow" on stock-gate holds. A hold the
-- founder has physically verified shouldn't keep shouting all day; it
-- resurfaces next day only if the product is still held (Graeme,
-- 2026-09-10 — repeated warnings were devaluing the warnings).
ALTER TABLE stock_gate_holds ADD COLUMN IF NOT EXISTS ack_until DATE;
ALTER TABLE stock_gate_holds ADD COLUMN IF NOT EXISTS ack_by TEXT;
