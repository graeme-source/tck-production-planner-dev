-- Return-to-work: the two standard questions worth keeping (Graeme,
-- 2026-09-14 — "minimal but effective"). Both optional; a historical
-- back-fill can carry just a reason.
ALTER TABLE return_to_work_forms ADD COLUMN IF NOT EXISTS doctor_seen boolean;
ALTER TABLE return_to_work_forms ADD COLUMN IF NOT EXISTS work_related boolean;
