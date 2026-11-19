-- An order that covers more than one production day (Graeme, 19 Nov 2026:
-- AB Fruits moved to £100 minimum, so deliveries go to Mon/Wed/Fri and the
-- Monday and Wednesday deliveries each cover two production days). Per
-- delivery weekday ("1" = Monday … "7" = Sunday), the extra % of the plan's
-- own requirement this supplier's order adds — 100 = one more day. NULL =
-- one day, exactly as before. Set on the supplier; the Orders page adds it
-- to the surplus so the team just orders what it says. Objective C.
-- Safe to run twice.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS extra_cover_by_delivery_weekday JSONB;
