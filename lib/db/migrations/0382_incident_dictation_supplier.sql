-- Incident reports from dictation + an email to the supplier (Graeme,
-- 19 Nov 2026: "the first step is just to dictate what the incident is, and
-- then it creates the incident report"; mouldy in-date cheese or bone in the
-- duck → choose the supplier and email them a report). Objectives B and F.
--
-- dictation       — the words as spoken, kept unedited beside the AI's write-up
-- supplier_issue  — the AI (or a person) says a supplier's product was at fault
-- supplier_id / ingredient_id — which supplier and which of their products
-- product_batch_code / product_use_by — read off the pack, if anyone has it
-- supplier_email_* — what was sent, to whom, by whom, when (one send per report)
-- Safe to run twice.

ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS dictation TEXT;
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS supplier_issue BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL;
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS product_batch_code TEXT;
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS product_use_by DATE;
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS supplier_email_to TEXT;
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS supplier_email_subject TEXT;
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS supplier_email_body TEXT;
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS supplier_email_sent_at TIMESTAMP;
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS supplier_email_sent_by_name TEXT;
