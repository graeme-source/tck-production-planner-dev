-- Reasons to Buy guidance (Graeme, 18 Nov 2026): for each reason, how it's
-- usually run — about how many emails, over how many days, who it goes to,
-- and the shortest gap before it's used again ("You've got credit" about
-- every 2 months; Wonkyzone clearance one email, at most monthly). Guidance
-- for whoever plans the emails, not hard rules. All optional. Objective I.
-- Safe to run twice.

ALTER TABLE marketing_reasons_to_buy ADD COLUMN IF NOT EXISTS emails_per_use INTEGER;
ALTER TABLE marketing_reasons_to_buy ADD COLUMN IF NOT EXISTS days_per_use INTEGER;
ALTER TABLE marketing_reasons_to_buy ADD COLUMN IF NOT EXISTS min_gap_days INTEGER;
-- Keys from AUDIENCES in lib/marketing-calendar/src/reasons-to-buy.ts.
ALTER TABLE marketing_reasons_to_buy ADD COLUMN IF NOT EXISTS audiences TEXT[] NOT NULL DEFAULT '{}';
