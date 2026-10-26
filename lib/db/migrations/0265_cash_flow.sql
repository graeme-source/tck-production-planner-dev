-- Cash flow (Graeme, 26 Oct 2026). Objective B.
--
-- "A basic cash flow page ... based on our QuickBooks integration and the AP
-- ageing summary ... how much cash we've got in the bank, which we will
-- manually set to start with. We can add miscellaneous outflows on different
-- days ... associate those with suppliers ... 'recurring every 4 days' ...
-- bring the Shopify payout values directly from Shopify."
--
-- Bills come live from QuickBooks and payouts live from Shopify; only what
-- people type is stored here.
--
--   cash_flow_settings  one row: the bank balance and the day it was true
--   cash_flow_items     hand-added money in/out: one-off on `on_date`, or
--                       every `every_days` days from `starts_on` (to `ends_on`)

CREATE TABLE IF NOT EXISTS cash_flow_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bank_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  balance_as_of DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_by_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_flow_items (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'out' CHECK (direction IN ('in', 'out')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  on_date DATE,
  every_days INTEGER CHECK (every_days IS NULL OR every_days BETWEEN 1 AND 365),
  starts_on DATE,
  ends_on DATE,
  fin_vendor_id INTEGER REFERENCES fin_vendors(id) ON DELETE SET NULL,
  vendor_name TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cash_flow_items_when CHECK (on_date IS NOT NULL OR (every_days IS NOT NULL AND starts_on IS NOT NULL))
);
