-- Supplier minimum order values (Graeme, 2026-10-01). Objective C — never
-- run out, order well: some suppliers won't deliver below a minimum spend
-- (AB Fruits: £75). When an order falls short we sometimes move an item we'd
-- normally buy elsewhere (double cream, grated cheddar) onto that supplier's
-- order to reach it — dearer per pack, but the delivery still comes.
--
-- 1) suppliers.minimum_order_value — the minimum order spend in £.
--    NULL = no minimum (the default; every existing supplier is unchanged).
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS minimum_order_value NUMERIC(10,2);

-- 2) ingredients.secondary_cost_per_pack — the price per pack at the
--    ingredient's SECONDARY supplier (cost_per_pack stays the primary
--    supplier's price). Optional: NULL means "not known", and the Orders page
--    falls back to the primary price and flags it as not confirmed.
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS secondary_cost_per_pack NUMERIC(10,4);
