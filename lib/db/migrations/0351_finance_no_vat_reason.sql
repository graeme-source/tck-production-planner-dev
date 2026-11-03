-- Outstanding transactions that will never have a VAT invoice (Graeme,
-- 3 Nov 2026), set by the one "No VAT invoice" control that replaced "Not
-- needed". 'dla' = a personal purchase made on a business card: the
-- bookkeeper posts it to the Director's Loan Account with no VAT reclaim.
-- 'other' = no VAT invoice for another reason, given in status_note.
-- Such a line goes to the bookkeeper's list without a document and closes
-- once it's posted in QuickBooks. NULL = the normal rule (VAT invoice needed).
ALTER TABLE fin_lines ADD COLUMN IF NOT EXISTS no_vat_reason TEXT;
