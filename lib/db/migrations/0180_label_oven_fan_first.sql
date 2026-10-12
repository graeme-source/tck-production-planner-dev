-- Product labels: oven temperatures read fan first (Graeme, 2026-10-12):
-- nearly everyone has a fan oven, and reading the conventional figure first
-- gets a fan oven set about 20°C too hot. The wording now uses one ready-
-- made fill-in, {ovenTemps} → "180°C fan (200°C)" (just "200°C" when a
-- recipe has no fan figure). Objective D.
--
-- Saved templates keep their own wording, so this moves the two old ways
-- of writing the oven temperature over to {ovenTemps}, in every step, on
-- every template that still uses them. Anything else in a step is left as
-- it is, and re-running finds nothing to change. The template version goes
-- up by one, like a save from Label design, so labels show the change.
UPDATE product_label_templates
SET settings = jsonb_set(settings, '{text,steps}', (
      SELECT jsonb_agg(to_jsonb(replace(replace(step,
               $t${ovenTemp}°C[ ({fanTemp}°C fan)]$t$, '{ovenTemps}'),
               $t${ovenTemp}°C ({fanTemp}°C fan)$t$, '{ovenTemps}')) ORDER BY n)
      FROM jsonb_array_elements_text(settings->'text'->'steps') WITH ORDINALITY AS s(step, n))),
    version = version + 1,
    updated_at = NOW(),
    updated_by_name = 'Oven temperatures fan first (release)'
WHERE jsonb_typeof(settings->'text'->'steps') = 'array'
  AND (settings->'text'->'steps')::text LIKE '%°C fan)%';
