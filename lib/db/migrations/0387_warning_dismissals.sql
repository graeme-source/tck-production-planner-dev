-- Who dismissed a warning, and when (Graeme, 20 Nov 2026: #140013 was named
-- by the 2:16 order check on 18 Nov and never sent, and nothing recorded
-- whether the alert was dismissed or by whom). One row each time someone
-- dismisses, puts off or re-checks an operational warning: the 2:16 check,
-- a kanban "Not today", a supplier order dismissed on Orders, an order that
-- didn't finish completing on Packing, the 2:55 stock-check pop-up.
-- Objectives C and F. Safe to run twice.

CREATE TABLE IF NOT EXISTS warning_dismissals (
  id SERIAL PRIMARY KEY,
  warning TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  page TEXT,
  user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  user_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS warning_dismissals_created_idx ON warning_dismissals (created_at DESC);
