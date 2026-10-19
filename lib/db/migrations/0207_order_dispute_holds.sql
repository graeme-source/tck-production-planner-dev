-- Chargeback holds on despatch (Graeme, 19 Oct 2026). Objective D.
--
-- "An order was sent for despatch despite a chargeback being open for it.
-- Make sure we never send an order that's got an active or open chargeback."
--
-- open_order_disputes   one row per Shopify order that has an OPEN dispute
--                       (chargeback or inquiry, status needs_response /
--                       under_review). A mirror of Shopify, replaced on
--                       every refresh (every 10 minutes, and on demand when
--                       the packing screen loads). Every despatch path
--                       refuses an order listed here.
--
-- order_dispute_refresh one row (id = 1): when the list was last fetched
--                       successfully, when it was last attempted, and the
--                       last error — so a stale list is visible and
--                       despatch falls back to a direct check per order.
--
-- No data change. Idempotent: re-running changes nothing.

CREATE TABLE IF NOT EXISTS open_order_disputes (
  shopify_order_id BIGINT PRIMARY KEY,
  order_name TEXT,
  -- e.g. "chargeback:under_review" — every open dispute on the order.
  statuses TEXT[] NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS open_order_disputes_order_name_idx ON open_order_disputes (order_name);

CREATE TABLE IF NOT EXISTS order_dispute_refresh (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  fetched_at TIMESTAMPTZ,
  attempted_at TIMESTAMPTZ,
  last_error TEXT
);
