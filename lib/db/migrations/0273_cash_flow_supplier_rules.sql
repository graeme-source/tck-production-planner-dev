-- Cash flow supplier payment rules (Graeme, 27 Oct 2026). Objective B.
--
-- "Due dates from QuickBooks aren't reliable ... AB Fruits is always, I
-- think, on the 1st of the month for everything, up until maybe the 15th ...
-- We need to be able to set rules for certain things ... override it in the
-- cash flow." QuickBooks is never written to; these only change the planner's
-- forecast. One rule per supplier, matched on vendor_key (the name lower-cased
-- with spaces and punctuation removed, worked out in the app).
--
--   kind                     uses
--   days_after               days            N days after the bill date
--   next_month_day           day_of_month    day D of the month after the bill
--   next_month_day_cutoff    day_of_month,   day D of the month after the bill,
--                            cutoff_day      or the month after that if the bill
--                                            is dated after day C
--   qbo                      —               QuickBooks' own due date

CREATE TABLE IF NOT EXISTS cash_flow_supplier_rules (
  id SERIAL PRIMARY KEY,
  vendor_key TEXT NOT NULL UNIQUE,
  vendor_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('days_after', 'next_month_day', 'next_month_day_cutoff', 'qbo')),
  days INTEGER CHECK (days IS NULL OR days BETWEEN 0 AND 365),
  day_of_month INTEGER CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31),
  cutoff_day INTEGER CHECK (cutoff_day IS NULL OR cutoff_day BETWEEN 1 AND 31),
  notes TEXT,
  updated_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
