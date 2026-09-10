-- Supplier contact + chase tracking on finance lines (Graeme, 2026-09-10).
-- order_reference / supplier_email / supplier_website: extracted from an
-- attached order confirmation (or typed), so the accounts team can chase a
-- VAT invoice without re-reading the document. chase bookkeeping exists so
-- nobody ever emails a supplier twice without knowing ("finding out I've
-- already emailed them before" was the whole pain).
ALTER TABLE fin_lines ADD COLUMN IF NOT EXISTS order_reference TEXT;
ALTER TABLE fin_lines ADD COLUMN IF NOT EXISTS supplier_email TEXT;
ALTER TABLE fin_lines ADD COLUMN IF NOT EXISTS supplier_website TEXT;
ALTER TABLE fin_lines ADD COLUMN IF NOT EXISTS chase_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fin_lines ADD COLUMN IF NOT EXISTS last_chased_at TIMESTAMP;
