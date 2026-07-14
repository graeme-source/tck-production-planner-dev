-- Migration: Product specification sheets (BRC-style trade specs)
--
-- This project uses `drizzle-kit push`; this file mirrors the updated schema
-- in lib/db/src/schema/product_specifications.ts and the idempotent block in
-- artifacts/api-server/src/index.ts (runStartupMigrations) that actually
-- applies it on deploy.
--
-- Adds:
--   * ingredients.country_of_origin — for the origin column on spec sheets
--   * product_specifications        — one row per recipe, the buyer-facing
--                                     detail that can't be derived from the
--                                     recipe tree (storage/cooking/packaging/
--                                     organoleptic/micro + version & approval)
--   * company_profile               — single-row manufacturer/site block

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS country_of_origin text;

CREATE TABLE IF NOT EXISTS product_specifications (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER NOT NULL UNIQUE REFERENCES recipes(id) ON DELETE CASCADE,
  legal_name TEXT,
  product_description TEXT,
  intended_use TEXT,
  storage_instructions TEXT,
  usage_instructions TEXT,
  may_contain_override TEXT,
  packaging_spec JSONB,
  organoleptic_standards JSONB,
  micro_criteria JSONB,
  dietary_suitability TEXT,
  spec_version INTEGER NOT NULL DEFAULT 1,
  spec_status TEXT NOT NULL DEFAULT 'draft',
  prepared_by TEXT,
  approved_by TEXT,
  approved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_profile (
  id INTEGER PRIMARY KEY DEFAULT 1,
  legal_business_name TEXT,
  trading_name TEXT,
  site_address TEXT,
  fbo_registration_number TEXT,
  local_authority TEXT,
  certification_status TEXT,
  technical_contact_name TEXT,
  technical_contact_email TEXT,
  technical_contact_phone TEXT,
  emergency_contact TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
