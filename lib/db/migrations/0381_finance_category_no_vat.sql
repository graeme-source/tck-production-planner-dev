-- A category can mean "no VAT invoice will ever come" (Graeme, 19 Nov 2026:
-- a DLA purchase — personal spend on a business card — has no invoice to
-- chase). Choosing such a category marks the transaction "No VAT invoice"
-- with that reason, which sends it to the Inbox to be posted. Values are
-- NO_VAT_REASONS in api-server lib/finance/posted-rules.ts ('dla', 'other').
-- "G Carter- DLA" is named exactly as its QuickBooks account (DLA:G Carter- DLA).
-- Objective I. Safe to run twice.

ALTER TABLE fin_categories ADD COLUMN IF NOT EXISTS no_vat_reason TEXT;

INSERT INTO fin_categories (name, sort_order, no_vat_reason) VALUES ('G Carter- DLA', 60, 'dla')
ON CONFLICT (name) DO UPDATE SET no_vat_reason = 'dla';
