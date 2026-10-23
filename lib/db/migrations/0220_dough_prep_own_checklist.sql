-- Dough Prep gets its own checklist, separate from Dough Sheeting (Fix queue
-- #171, Ji-Hey Kim: "Please separate dough sheeting and dough mix check
-- list"). Objective F. DATA ONLY — no schema change.
--
-- Until now dough_prep was aliased onto dough_sheeting's checklist (code:
-- artifacts/api-server/src/lib/checklist-stations.ts). That alias is removed
-- in the same change, so without this file Dough Prep would open to an empty
-- list. Items on the shared list carry a label in their title saying whose
-- job they are; this sorts them by that label (by title, never by id):
--
--   '(Dough mix)'             → MOVE to dough_prep (comes off Dough Sheeting).
--                               Their tick history moves with them (the
--                               completion rows are re-keyed to dough_prep),
--                               so nothing ticked earlier today disappears.
--   '(Dough sheeting)' only   → stay on Dough Sheeting only.
--   everything else           → stay on Dough Sheeting AND a copy is made for
--                               Dough Prep: items labelled for both (e.g.
--                               '(Dough mix & dough sheeting)', '(Dough
--                               mixing)') and every unlabelled item (opening,
--                               closing, temperature checks...). The copies
--                               start with no history; past ticks stay on
--                               Dough Sheeting's originals.
--
-- Afterwards the team removes/adds items on each station's own checklist and
-- drops the '(Dough mix)' / '(Dough sheeting)' labels.
--
-- Only active templates are touched. Idempotent: a copy is skipped when
-- Dough Prep already has an active item with the same category and title,
-- and a re-run finds no '(Dough mix)' items left on Dough Sheeting.

-- 1. Copy the shared and unlabelled items for Dough Prep.
INSERT INTO checklist_templates
  (station_type, category, title, description, schedule, schedule_days,
   order_position, dynamic_data_type, is_active, schedule_anchor_date)
SELECT 'dough_prep', t.category, t.title, t.description, t.schedule, t.schedule_days,
       t.order_position, t.dynamic_data_type, true, t.schedule_anchor_date
  FROM checklist_templates t
 WHERE t.station_type = 'dough_sheeting'
   AND t.is_active
   -- not a Dough-mix-only item (those move in step 2)
   AND t.title !~* '\(\s*dough\s+mix\s*\)'
   -- not a Dough-sheeting-only item (label exactly '(Dough sheeting)';
   -- '(Dough mix & dough sheeting)' doesn't match, so it is copied)
   AND t.title !~* '\(\s*dough\s+sheeting\s*\)'
   AND NOT EXISTS (
     SELECT 1 FROM checklist_templates d
      WHERE d.station_type = 'dough_prep'
        AND d.is_active
        AND d.category = t.category
        AND lower(btrim(d.title)) = lower(btrim(t.title))
   );

-- 2. Move the Dough-mix-only items (and their tick history) to Dough Prep.
UPDATE checklist_completions c
   SET station_type = 'dough_prep'
  FROM checklist_templates t
 WHERE t.id = c.template_id
   AND t.station_type = 'dough_sheeting'
   AND t.is_active
   AND t.title ~* '\(\s*dough\s+mix\s*\)';

UPDATE checklist_templates
   SET station_type = 'dough_prep'
 WHERE station_type = 'dough_sheeting'
   AND is_active
   AND title ~* '\(\s*dough\s+mix\s*\)';
