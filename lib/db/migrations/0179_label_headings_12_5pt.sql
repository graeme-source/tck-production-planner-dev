-- Product labels: the section headings ("STORAGE INSTRUCTIONS:" and
-- "THE INGREDIENTS:") go from 10.5 pt to 12.5 pt on the saved label
-- templates (Graeme, 2026-10-12: "a bit bigger than the body copy"; the
-- storage heading should almost fill its column). Objective D.
--
-- Only templates still on the old 10.5 pt default are changed, so a size
-- someone has since chosen in Label design & type is left alone, and
-- re-running does nothing. The template version goes up by one, the same
-- as a save from the Label design page, so each label shows the template
-- changed since it was published.
UPDATE product_label_templates
SET settings = jsonb_set(
      jsonb_set(settings, '{fields,headings,maxPt}', '12.5'::jsonb),
      '{fields,headings,minPt}', '12.5'::jsonb),
    version = version + 1,
    updated_at = NOW(),
    updated_by_name = 'Label headings 12.5 pt (release)'
WHERE settings #>> '{fields,headings,maxPt}' = '10.5'
  AND settings #>> '{fields,headings,minPt}' = '10.5';
