-- Month-end adjustments for the accountant (Graeme, 27 Oct 2026).
-- Objective I.
--
-- At every calendar month end, Finance → Payroll works out:
--   * deferred income — orders paid by 23:59 London time on the last day
--     but not dispatched by then (lib/payroll/month-end.ts has the rules);
--   * the labour that belongs to that month but is paid in the next pay
--     period (shifts from the 25th to the month end).
--
-- Working these out reads Shopify (the orders mirror) and Planday, so once
-- a month end is FINAL — the pay period holding its labour has ended — the
-- result is kept here and reused by the history (31 Mar 2025 onwards).
-- "Recalculate" overwrites a row. Nothing else depends on this table: it is
-- a cache, and deleting a row only means it gets worked out again.

CREATE TABLE IF NOT EXISTS month_end_adjustments (
  month_end DATE PRIMARY KEY,
  -- DeferredIncome (incl. the deferred orders) and MonthEndLabour as JSON.
  deferred JSONB NOT NULL,
  labour JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  computed_by_name TEXT
);
