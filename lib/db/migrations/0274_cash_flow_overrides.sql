-- Cash flow hand moves (Graeme, 27 Oct 2026). Objective B.
--
-- "I want to be able to drag and drop things around so I can push things
-- back and decide to pay things later." One row per moved line on the cash
-- flow: a QuickBooks bill (ref = bill id), a Shopify payout (ref = payout id)
-- or one date of a hand-added item (ref = cash_flow_items.id, occurrence =
-- the date it would have fallen on; '' for bills and payouts).
--
-- A move beats a supplier rule, which beats QuickBooks' due date. Moves for
-- bills that have since been paid (gone from QuickBooks' open bills) and
-- payouts that have been paid are deleted when the page next loads cleanly.

CREATE TABLE IF NOT EXISTS cash_flow_overrides (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('bill', 'payout', 'item')),
  ref TEXT NOT NULL,
  occurrence TEXT NOT NULL DEFAULT '',
  planned_date DATE NOT NULL,
  moved_from DATE,
  label TEXT,
  moved_by_name TEXT,
  moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, ref, occurrence)
);
