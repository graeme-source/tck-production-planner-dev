-- Label rules for the prep-room ingredient labels (Stage 2).
--
-- opened_life_days: food-safe days after OPENING (distinct from
-- shelf_life_days, which is the unopened figure used by ordering).
-- Null = fall back to the category default in app_settings
-- ('label_opened_life_defaults'), then to the conservative global default.
--
-- defrost_life_days: food-safe days after DEFROSTING (used by the Stage 4
-- defrost labels; added now so the rules land in one migration).
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS opened_life_days INTEGER;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS defrost_life_days INTEGER;
