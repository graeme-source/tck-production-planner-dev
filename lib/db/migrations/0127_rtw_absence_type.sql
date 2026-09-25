-- Return-to-work forms for ANY absence, not just sickness (Graeme,
-- 2026-09-25: "we've got dependants' leave as well as sick leave to do a
-- return-to-work form on, just to record the reason"). The form records
-- what kind of absence it was — the Planday shift-type name(s) for a
-- detected spell ("Sick Leave", "Dependants Leave", "Sick Leave + Absent"),
-- or the type chosen when a manager records an absence Planday doesn't
-- show. NULL on older forms, which were all sickness.
ALTER TABLE return_to_work_forms ADD COLUMN IF NOT EXISTS absence_type text;
