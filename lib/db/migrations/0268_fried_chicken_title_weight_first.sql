-- Fried chicken labels lead with the weight (Graeme, 27 Oct 2026):
-- "500g - Korean Fried Chicken", so the 500g and 1.2kg bags of one flavour
-- are easy to tell apart when picking. Objective D.
--
-- Only the "Fried chicken" template, and only while its title is still the
-- original "{name}" — if someone has already typed their own title in Label
-- design, it's left alone. No fried chicken label has been published, so no
-- live label changes.

UPDATE product_label_templates
   SET settings = jsonb_set(settings, '{text,title}', '"{weightFirstName}"'),
       version = version + 1,
       updated_at = NOW(),
       updated_by_name = 'Weight first in the title (release)'
 WHERE lower(trim(name)) = 'fried chicken'
   AND settings -> 'text' ->> 'title' = '{name}';
