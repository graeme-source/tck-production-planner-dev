-- APC consignments: collection date, retirement and APC-status columns
-- (Graeme, 19 Oct 2026). Objective F (trustworthy daily use).
--
-- Incident #136845: booked with APC on 7 Oct, cancelled in APC at 14:43 the
-- same day when the order was moved to the 16th — but our row was never
-- marked cancelled. On 15 Oct the packing screen treated that old row as
-- "this order is already booked", booked nothing new, and pushed the dead
-- waybill to Shopify. The parcel reached the hub on a cancelled consignment
-- and was disposed of on 19 Oct.
--
-- From now on an existing consignment may only be reused when it is for
-- TODAY's collection (London date) and is neither cancelled nor superseded.
--
-- apc_consignments.collection_date      the day APC collects it. Bookings
--                                       always collect on the booking day;
--                                       backfilled from the waybill's own
--                                       leading 8 digits (APC's send date),
--                                       else the London date of created_at.
-- apc_consignments.cancelled_reason     why cancelled_at was set, e.g.
--                                       "cancelled in APC" when tracking
--                                       says CANCELLED (status 97).
-- apc_consignments.superseded_at/_reason the order moved to another
--                                       delivery date (reschedule) or the
--                                       booking was for another day, so it
--                                       must never be reused again.
-- apc_consignments.apc_status*          the last tracking status we read
--                                       (read-only GET), plus the dead
--                                       status (CANCELLED / DISPOSED OF) if
--                                       one has ever appeared.
-- apc_consignments.apc_cancel_*         what a manager decided about an old
--                                       booking that is still live in APC:
--                                       'cancelled_via_app' | 'cancel_by_hand'
--                                       | 'keep'. Nothing is cancelled at
--                                       APC without that confirm.
-- apc_consignments.mismatch_notified_at the daily check has already told
--                                       Graeme about this row.
--
-- Idempotent: re-running changes nothing.

ALTER TABLE apc_consignments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE apc_consignments ADD COLUMN IF NOT EXISTS dispatch_tag TEXT;
ALTER TABLE apc_consignments ADD COLUMN IF NOT EXISTS label_printed_at TIMESTAMP;
ALTER TABLE apc_consignments ADD COLUMN IF NOT EXISTS collection_date DATE;
ALTER TABLE apc_consignments ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;
ALTER TABLE apc_consignments ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMP;
ALTER TABLE apc_consignments ADD COLUMN IF NOT EXISTS superseded_reason TEXT;
ALTER TABLE apc_consignments ADD COLUMN IF NOT EXISTS apc_status TEXT;
ALTER TABLE apc_consignments ADD COLUMN IF NOT EXISTS apc_status_code TEXT;
ALTER TABLE apc_consignments ADD COLUMN IF NOT EXISTS apc_dead_status TEXT;
ALTER TABLE apc_consignments ADD COLUMN IF NOT EXISTS apc_status_checked_at TIMESTAMP;
ALTER TABLE apc_consignments ADD COLUMN IF NOT EXISTS apc_cancel_decision TEXT;
ALTER TABLE apc_consignments ADD COLUMN IF NOT EXISTS apc_cancel_decided_by TEXT;
ALTER TABLE apc_consignments ADD COLUMN IF NOT EXISTS apc_cancel_decided_at TIMESTAMP;
ALTER TABLE apc_consignments ADD COLUMN IF NOT EXISTS mismatch_notified_at TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apc_consignments_cancel_decision_check') THEN
    ALTER TABLE apc_consignments ADD CONSTRAINT apc_consignments_cancel_decision_check
      CHECK (apc_cancel_decision IS NULL OR apc_cancel_decision IN ('cancelled_via_app', 'cancel_by_hand', 'keep'));
  END IF;
END $$;

-- Backfill: the waybill's first 8 digits are APC's send date (YYYYMMDD) —
-- the collection day for every booking the app or Hypaship raises. Rows
-- whose waybill doesn't carry a valid date fall back to the London date
-- of created_at (stored as UTC wall time).
UPDATE apc_consignments
SET collection_date = to_date(substring(waybill from 1 for 8), 'YYYYMMDD')
WHERE collection_date IS NULL
  AND waybill ~ '^(20[0-9]{2})(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[0-9]{14}$';

UPDATE apc_consignments
SET collection_date = ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London')::date
WHERE collection_date IS NULL;

CREATE INDEX IF NOT EXISTS ix_apc_consignments_pushed ON apc_consignments (pushed_to_shopify_at);
CREATE INDEX IF NOT EXISTS ix_apc_consignments_superseded ON apc_consignments (superseded_at);
