-- Customer cooking times: Suggested (by weight) or Manual, per recipe
-- (Graeme, 2026-10-12). Objective D (lawful, safe labels).
--
-- product_label_settings.cooking_mode:
--   'suggested' = the label template's weight-tier times (cookingTiers),
--                 when the template has them switched on;
--   'manual'    = this recipe's own oven / air-fryer values;
--   NULL        = not chosen: manual when the recipe has any cooking value
--                 of its own (Garlic Cheese keeps its hand-set times),
--                 otherwise suggested.
-- No rows are changed. The tiers start switched off, so nothing on any
-- label changes until a manager switches them on in Label design & type.
ALTER TABLE product_label_settings ADD COLUMN IF NOT EXISTS cooking_mode TEXT;
DO $$ BEGIN
  ALTER TABLE product_label_settings ADD CONSTRAINT product_label_settings_cooking_mode_check
    CHECK (cooking_mode IS NULL OR cooking_mode IN ('suggested', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
