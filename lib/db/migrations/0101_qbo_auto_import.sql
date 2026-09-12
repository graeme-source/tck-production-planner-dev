-- Indirect Capital-on-Tap import via QuickBooks (Graeme, 2026-09-12):
-- purchases paid from a chosen QBO account (the CoT card) become finance
-- lines automatically, replacing the CSV upload. The mirror learns which
-- account paid each purchase; the connection stores the chosen account and
-- the switch-on date (so history doesn't flood the queue).
ALTER TABLE fin_qbo_txns ADD COLUMN IF NOT EXISTS account_name text;
ALTER TABLE fin_qbo_txns ADD COLUMN IF NOT EXISTS payment_type text;
ALTER TABLE fin_qbo_connection ADD COLUMN IF NOT EXISTS auto_import_account text;
ALTER TABLE fin_qbo_connection ADD COLUMN IF NOT EXISTS auto_import_since date;
