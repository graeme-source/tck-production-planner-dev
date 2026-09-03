-- The fried chicken station (Graeme, 2026-09-03). Fried chicken is produced
-- separately from the calzone line and has always run off a paper sheet; this
-- brings it into the planner as a station of its own, deliberately NOT part of
-- main prep.
--
-- This migration seeds its opening / cleaning / closing checks, taken verbatim
-- from the "Fried Chicken Cleaning and Check Schedule" sheet the team already
-- works to, so nothing changes underfoot for whoever is standing there.
--
-- The one addition to the paper list is the last closing check: production is
-- not finished until what was ACTUALLY made has been sent to Shopify. The plan
-- is only ever a target — the sauce runs out where it runs out — so the count
-- sheet is the truth, and it is the count sheet that updates stock.

INSERT INTO checklist_templates (station_type, category, title, schedule, order_position, is_active)
SELECT 'fried_chicken', v.category, v.title, 'daily', v.pos, true
FROM (VALUES
  ('opening',  'Gas hose plugged in',                                        0),
  ('opening',  'Safety cable attached',                                      1),
  ('opening',  'Extractor on',                                               2),

  ('cleaning', 'Oil drum (silver)',                                          0),
  ('cleaning', 'All surfaces and shelves two stage cleaned',                 1),
  ('cleaning', 'Blast Chiller rack - two stage clean',                       2),
  ('cleaning', 'Blast Chiller and floor',                                    3),
  ('cleaning', 'Washing up done',                                            4),
  ('cleaning', 'Fryers x 2 clean and drain pipes closed',                    5),
  ('cleaning', 'Sweep and mop all factory floors',                           6),
  ('cleaning', 'Mop floor with de-greaser around frying area',               7),
  ('cleaning', 'Clean gas connection on yellow hose to wall',                8),

  ('closing',  'Empty bins',                                                 0),
  ('closing',  'Upload Chicken count sheet to data recording (whatsapp)',    1),
  ('closing',  'Close blind',                                                2),
  ('closing',  'Close double doors to factory',                              3),
  -- Last, and last on purpose: the day is not closed until the shelf is right.
  ('closing',  'Submit today''s counted bags to Shopify stock',              4)
) AS v(category, title, pos)
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_templates t
  WHERE t.station_type = 'fried_chicken' AND t.category = v.category AND t.title = v.title
);
