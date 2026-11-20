-- A safety warning that follows an ingredient onto the stations (Fix queue
-- #404, Dave Bewsey, from improvement idea #392; Graeme approved 20 Nov
-- 2026). Objective D.
--
-- "Could we please have a pop up message on the mixing prep screen and the
-- builders screens when accessing duck (Donald) saying please be vigilant
-- for bones, if any found please fill in incident report with pictures."
--
--   ingredients.station_warning   free text, NULL = no warning.
--       Any recipe that uses the ingredient (directly, as a marinade or
--       through a sub-recipe) shows it as a full-screen pop-up on the
--       Mixing and Building screens, once per person per recipe per day,
--       with a button straight to the accident / incident report.
--       Managers set it per ingredient on the ingredient form.
--
-- Seed: Dave's wording on the shredded duck, only if nobody has written a
-- warning there already. Matched on id AND name so it can never land on a
-- different ingredient. Safe to run twice.

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS station_warning TEXT;

UPDATE ingredients
   SET station_warning = 'Please be vigilant for bones. If any are found, fill in an incident report with pictures of the bones / gristle.'
 WHERE id = 24
   AND name ILIKE 'Duck%'
   AND station_warning IS NULL;
