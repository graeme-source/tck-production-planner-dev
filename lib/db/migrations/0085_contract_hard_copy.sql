-- Signed contracts become undeletable hard copies (Graeme, 2026-09-07).
--
-- 1) signed_pdf: an archival PDF generated at the moment of signing (logo,
--    founder signature, employee initials baked in) — the hard copy, stored
--    on the row like risk_assessments stores its documents.
--
-- 2) Database-level protection, not just route-level: once acknowledged_at
--    is set, the row cannot be DELETEd (not even via the app_users cascade —
--    deleting a user with signed contracts is refused), and its body,
--    signature fields and owner cannot change. New versions are NEW rows;
--    the old ones stay listed in the employee's My Contract history.

ALTER TABLE employment_contracts ADD COLUMN IF NOT EXISTS signed_pdf BYTEA;

CREATE OR REPLACE FUNCTION employment_contracts_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.acknowledged_at IS NOT NULL THEN
      RAISE EXCEPTION 'Signed employment contracts are permanent records and cannot be deleted (contract %)', OLD.id;
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE: a signed row is frozen, except that signed_pdf may be backfilled
  -- when it is missing (the PDF is deterministic from the frozen body).
  IF OLD.acknowledged_at IS NOT NULL THEN
    IF NEW.body IS DISTINCT FROM OLD.body
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.employee_name IS DISTINCT FROM OLD.employee_name
       OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
       OR NEW.signed_initials IS DISTINCT FROM OLD.signed_initials
       OR (OLD.signed_pdf IS NOT NULL AND NEW.signed_pdf IS DISTINCT FROM OLD.signed_pdf) THEN
      RAISE EXCEPTION 'Signed employment contracts are immutable (contract %)', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS employment_contracts_protect_delete ON employment_contracts;
CREATE TRIGGER employment_contracts_protect_delete
  BEFORE DELETE ON employment_contracts
  FOR EACH ROW EXECUTE FUNCTION employment_contracts_protect();

DROP TRIGGER IF EXISTS employment_contracts_protect_update ON employment_contracts;
CREATE TRIGGER employment_contracts_protect_update
  BEFORE UPDATE ON employment_contracts
  FOR EACH ROW EXECUTE FUNCTION employment_contracts_protect();
