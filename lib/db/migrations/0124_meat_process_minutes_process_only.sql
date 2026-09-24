-- Meat lead time = estimated cook time + estimated process time (Graeme,
-- 2026-09-24).
--
-- ingredients.meat_process_minutes used to be a TOTAL typed by hand ("Cook +
-- Process Time"), separate from estimated_cook_time_min — so the cook time
-- was typed twice, and Beef Mince carried 6 (clearly meant as processing
-- only) against a 25-minute cook, putting "start cooking by" 25 minutes too
-- late. From now the column holds the PROCESSING part only, and the
-- schedule adds the cook time to it.
--
-- One-off conversion of existing values:
--   total >= cook  → it was a true total: processing = total - cook
--                    (Diced Beef 240/210 → 30, Pork 240/180 → 60, ...)
--   total <  cook  → it can only have been processing already (Beef Mince 6)
--   no cook time   → leave it (processing is the only figure there is)
UPDATE ingredients
   SET meat_process_minutes = meat_process_minutes - estimated_cook_time_min
 WHERE meat_process_minutes IS NOT NULL
   AND estimated_cook_time_min IS NOT NULL
   AND meat_process_minutes >= estimated_cook_time_min;
