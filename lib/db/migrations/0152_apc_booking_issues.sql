-- APC booking issues — today's failed bookings, kept (Graeme, 2026-10-09).
-- Objective F (trustworthy daily use) and G (glanceable status).
--
-- When a batch booking leaves orders without a label, the report of what
-- went wrong used to live only in the booking dialog: close it to carry on
-- packing and the only way back was to try booking those orders with APC
-- again. Now every failure is written here, keyed by the London day it
-- happened, and the packing screen reopens "Booking issues today" from
-- these rows — no APC call.
--
--   report_date      London calendar day the booking ran. The screen shows
--                    today's rows only; older rows stay as history.
--   one row per (report_date, shopify_order_id): a later run that fails
--   again updates the row (attempts + 1); one that books, or finds the
--   order already holding a consignment, marks it resolved.
--   postcode_service the APC postcode table answer at the time (snapshot;
--                    the screen re-reads the table + recorded APC answers).
--   scenario         what the rules in api-server lib/apc-booking-issues.ts
--                    made of it at the time: cant_deliver |
--                    saturday_permanent | saturday_temporary | other.
--   actions          append-only log of what people did on the card:
--                    [{ kind, at, byUserId, byName, detail }].
--   dealt_with_at    someone marked the card done by hand.

CREATE TABLE IF NOT EXISTS apc_booking_issues (
  id SERIAL PRIMARY KEY,
  report_date DATE NOT NULL,
  dispatch_tag TEXT NOT NULL,
  shopify_order_id BIGINT NOT NULL,
  order_name TEXT NOT NULL,
  admin_url TEXT,
  customer_name TEXT,
  customer_first_name TEXT,
  customer_email TEXT,
  postcode TEXT,
  reason TEXT,
  used_service_code TEXT,
  suggested_retry_code TEXT,
  saturday_attempt BOOLEAN NOT NULL DEFAULT FALSE,
  refused_no_service BOOLEAN NOT NULL DEFAULT FALSE,
  data_fixable BOOLEAN NOT NULL DEFAULT FALSE,
  postcode_service JSONB,
  postcode_check TEXT,
  scenario TEXT NOT NULL DEFAULT 'other',
  attempts INTEGER NOT NULL DEFAULT 1,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_failed_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_note TEXT,
  dealt_with_at TIMESTAMPTZ,
  dealt_with_by TEXT,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (report_date, shopify_order_id)
);

CREATE INDEX IF NOT EXISTS idx_apc_booking_issues_day ON apc_booking_issues (report_date, first_failed_at, id);
