-- Friday dispatch check — what was done (Graeme, 11 Nov 2026). Objective C.
--
-- The check (api-server lib/friday-dispatch-check.ts) lists the orders due
-- out on a Friday that APC won't deliver on the Saturday. Two things done
-- from it need remembering, because nothing else records them:
--   emailed  the "we can't deliver this Saturday" email went to the
--            customer (detail = the address it went to)
--   moved    the order was moved to Thursday's or next Tuesday's dispatch
--            from the check (detail = the new delivery-date tag). A moved
--            order no longer carries the Saturday tag, so without this row
--            it would simply vanish from the check.
-- Append-only; one row per press. Safe to run twice.

CREATE TABLE IF NOT EXISTS friday_check_actions (
  id SERIAL PRIMARY KEY,
  dispatch_date DATE NOT NULL,
  shopify_order_id BIGINT NOT NULL,
  order_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT,
  by_user_id INTEGER,
  by_name TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_friday_check_actions_day ON friday_check_actions (dispatch_date, shopify_order_id);
