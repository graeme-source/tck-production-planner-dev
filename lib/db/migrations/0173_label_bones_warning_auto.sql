-- Bones warning: Automatic by default (Graeme, 2026-10-12). Objective D
-- (lawful, traceable labels).
--
-- product_label_settings.warning_on now has three states:
--   TRUE  = always print the bones warning (set by hand)
--   FALSE = never print it (set by hand)
--   NULL  = Automatic: on when the recipe's ingredients contain one of the
--           label template's boneRiskWords (default "chicken").
--
-- Every TRUE today is only the old column default (nobody could choose
-- "automatic" before), so TRUE becomes NULL. FALSE rows were switched off by
-- hand and are kept. Published labels are not touched: each stores the
-- warning as it printed, and any label whose Automatic result differs shows
-- "Update needed" with the Bones warning change listed.
ALTER TABLE product_label_settings ALTER COLUMN warning_on DROP DEFAULT;
ALTER TABLE product_label_settings ALTER COLUMN warning_on DROP NOT NULL;
UPDATE product_label_settings SET warning_on = NULL WHERE warning_on IS TRUE;
