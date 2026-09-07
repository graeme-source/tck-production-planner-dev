-- Contract acknowledgement becomes a signature (Graeme, 2026-09-07):
-- the employee types their initials, which are written into the contract
-- body itself as an electronic signature record alongside the timestamp.
-- acknowledged_at stays as the signature timestamp; the initials live here.
ALTER TABLE employment_contracts ADD COLUMN IF NOT EXISTS signed_initials TEXT;
