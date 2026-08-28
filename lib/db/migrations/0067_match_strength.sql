-- Match-strength tiers (Graeme, 2026-08-28): a suggestion is graded by how
-- many of the four signals it carries — amount, date-in-window, company
-- name, order/transaction reference. 1 = weak, 2 = medium, 3 = strong,
-- 4 = very strong. Also: reference tokens harvested per indexed email.

ALTER TABLE fin_matches
  ADD COLUMN IF NOT EXISTS signals integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS strength text NOT NULL DEFAULT 'weak';

ALTER TABLE fin_email_index
  ADD COLUMN IF NOT EXISTS order_ids_found jsonb NOT NULL DEFAULT '[]'::jsonb;
