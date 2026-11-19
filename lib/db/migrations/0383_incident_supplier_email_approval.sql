-- Only a manager sends an incident email to a supplier (Graeme, 19 Nov 2026:
-- "so that not everyone can start firing off incident reports"). Anyone else
-- can draft it and ask: the draft is kept on the report (supplier_email_to /
-- _subject / _body, with sent_at still empty) and every manager gets a to-do
-- to approve it. These record who asked and when. Objectives B and F.
-- Safe to run twice.

ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS supplier_email_requested_at TIMESTAMP;
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS supplier_email_requested_by_name TEXT;
