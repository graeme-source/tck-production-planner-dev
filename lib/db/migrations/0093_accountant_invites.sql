-- Accountant invites: an invite can carry the bookkeeper flag, so an
-- external accountant lands straight in the finance-only experience —
-- no employment contract claim, no new-starter onboarding gate, none of
-- the team machinery (Graeme, 2026-09-09).
ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS is_bookkeeper BOOLEAN NOT NULL DEFAULT FALSE;
