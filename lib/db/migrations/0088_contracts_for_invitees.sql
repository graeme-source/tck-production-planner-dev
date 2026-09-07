-- Contracts for people who haven't accepted their invite yet (Graeme,
-- 2026-09-07). The natural order is: invite someone, issue their contract,
-- and have it waiting when they first log in — but a contract row needed an
-- app_users id, which doesn't exist until the invite is accepted.
--
-- A contract may now be addressed to an invite EMAIL instead: user_id is
-- nullable, invite_email carries the address, and accepting the invite
-- claims every unclaimed contract for that email onto the new account
-- (routes/invites.ts). Exactly one of the two must be set. The employee
-- name on an invite-issued contract is typed by the founder at generation —
-- it's on the contract face anyway.
ALTER TABLE employment_contracts ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE employment_contracts ADD COLUMN IF NOT EXISTS invite_email TEXT;
ALTER TABLE employment_contracts DROP CONSTRAINT IF EXISTS employment_contracts_addressee;
ALTER TABLE employment_contracts ADD CONSTRAINT employment_contracts_addressee
  CHECK (user_id IS NOT NULL OR invite_email IS NOT NULL);
CREATE INDEX IF NOT EXISTS employment_contracts_invite_email_idx
  ON employment_contracts (invite_email) WHERE invite_email IS NOT NULL;
