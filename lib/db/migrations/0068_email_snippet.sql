-- A short snippet of each indexed email so the reviewer can see what it
-- says without opening the mailbox (Graeme, 2026-08-28). Bodies are still
-- never stored — the snippet is the first ~400 characters of text, cut at
-- scan time.
ALTER TABLE fin_email_index ADD COLUMN IF NOT EXISTS snippet text;
