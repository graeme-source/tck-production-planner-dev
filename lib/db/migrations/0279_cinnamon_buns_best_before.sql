-- Cinnamon buns print a BEST BEFORE as well as the use-by (Graeme, 27 Oct
-- 2026): despatch day + 3. Labels print on the despatch day, so it counts
-- from the print day. Objective D.
--
-- Only the "Cinnamon buns" template, and only if no best-before has been set
-- on it yet. No cinnamon bun label has been published, so nothing live
-- changes. (Numbered 0279 to leave 0273+ to the cash-flow work in flight.)

UPDATE product_label_templates
   SET settings = jsonb_set(settings, '{bestBefore}',
         '{"on": true, "label": "BEST BEFORE:", "period": {"amount": 3, "unit": "days"}}'::jsonb),
       version = version + 1,
       updated_at = NOW(),
       updated_by_name = 'Best before = despatch + 3 (release)'
 WHERE lower(trim(name)) = 'cinnamon buns'
   AND NOT (settings ? 'bestBefore');
