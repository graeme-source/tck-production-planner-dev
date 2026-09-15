-- Pre-arrival footwear question (Graeme, 2026-09-12): shoe size plus a
-- two-way choice between Crocs and safety shoes, collected with the
-- contact/emergency details so the right pair is waiting on day one.
ALTER TABLE onboarding_submissions ADD COLUMN IF NOT EXISTS shoe_size text;
ALTER TABLE onboarding_submissions ADD COLUMN IF NOT EXISTS footwear_choice text;
