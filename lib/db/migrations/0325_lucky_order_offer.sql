-- Live offers, starting with "Lucky Order Number" (Graeme, 27 Oct 2026).
-- Objective I (founder command centre: sales levers he can switch on and off).
--
-- "A reliable automatic flow that adds a free gift to an order after it has
-- been placed, based on the order number ending in a 0... A full refund on
-- top of that for orders ending in 00... For orders ending in 000... a free
-- subscription for 6 orders every 8 weeks... up to the value of £75 per order."
--
-- Rules (lib/lucky-order/rules.ts):
--   ends in 000  -> free subscription year ONLY (single-use code, up to £75
--                   off each of 6 subscription orders, emailed)
--   ends in 00   -> free gift + full refund
--   ends in 0    -> free gift
-- Website orders and subscription renewals only; wholesale (tag
-- "wholesale") never. Refunds above the auto limit (£100) wait for the
-- founder's one-click approval.
--
-- live_offers: one row per offer the founder can switch on and off. Practice
-- mode (on by default) logs winners and what WOULD happen, touching nothing.
-- activated_at: orders placed before the offer was last switched on never
-- win retroactively.

CREATE TABLE IF NOT EXISTS live_offers (
  key           TEXT PRIMARY KEY,
  enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  practice_mode BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  activated_at  TIMESTAMPTZ,
  settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by    TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO live_offers (key, enabled, practice_mode, settings)
VALUES ('lucky_order_number', FALSE, TRUE,
        '{"refundAutoLimit": 100, "subscriptionAmount": 75, "subscriptionCycles": 6}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- One row per winning order — the audit trail and the work queue. Each step
-- has its own status so a retry never repeats a step that already happened.
--   *_status: n/a | practice | pending | awaiting_approval | approved |
--             done | declined | failed
CREATE TABLE IF NOT EXISTS lucky_order_winners (
  order_id        TEXT PRIMARY KEY,            -- Shopify order GID
  order_name      TEXT NOT NULL,
  order_number    BIGINT NOT NULL,
  tier            TEXT NOT NULL,               -- gift | gift_refund | subscription
  practice        BOOLEAN NOT NULL,
  source_name     TEXT,
  customer_id     TEXT,
  customer_email  TEXT,
  customer_name   TEXT,
  order_total     NUMERIC(10,2),
  order_created_at TIMESTAMPTZ NOT NULL,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  gift_status     TEXT NOT NULL,
  gift_title      TEXT,
  refund_status   TEXT NOT NULL,
  refund_amount   NUMERIC(10,2),
  refund_decided_by TEXT,
  code_status     TEXT NOT NULL,
  discount_code   TEXT,
  email_status    TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lucky_order_winners_detected_idx ON lucky_order_winners (detected_at DESC);
