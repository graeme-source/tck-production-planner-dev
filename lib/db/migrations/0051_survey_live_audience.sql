-- Live survey email audiences: remember which Shopify collection a survey
-- was generated from (the ground truth for "these products") and the Klaviyo
-- segment built from it, so live sends reuse one segment per survey.
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS collection_id BIGINT;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS collection_title TEXT;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS klaviyo_segment_id TEXT;
