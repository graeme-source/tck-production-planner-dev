-- Our account number with each supplier (Graeme, 21 Oct 2026). Objective C
-- (stock stays right — problems at goods-in get credited fast).
--
-- "In the automatic emails we send to the Brakes account manager when we
-- receive raw chicken that's short-shelf-life or anything, we need to
-- include the product code and also the account number, which is 1867332."
--
--   suppliers.account_number   NULL = none on file. Edited on the supplier
--       record beside the account manager; printed near the top of the
--       goods-in issue email ("Account number: …"), omitted when empty.
--
-- Seed: Brakes' number, only where it isn't set yet and only when exactly
-- ONE supplier's name starts with "Brakes" (matched by name, never by id).
-- Idempotent: re-running changes nothing.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS account_number TEXT;

UPDATE suppliers
   SET account_number = '1867332'
 WHERE name ILIKE 'brakes%'
   AND account_number IS NULL
   AND (SELECT COUNT(*) FROM suppliers WHERE name ILIKE 'brakes%') = 1;
