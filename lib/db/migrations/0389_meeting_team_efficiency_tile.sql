-- The morning meeting's Last Production Day slide gets a Team efficiency tile
-- (Graeme, 20 Nov 2026), placed after the packing tile. Slides that list
-- their tiles by name would never pick up a new default, so add it to every
-- template slide that has a list and doesn't have it yet. Meetings copy the
-- template, so it shows from the next meeting on. Objective I. Safe to run twice.

UPDATE template_slides
SET config_json = jsonb_set(
  config_json, '{kpis}',
  (
    SELECT jsonb_agg(k ORDER BY ord)
    FROM (
      SELECT value AS k, (ordinality * 10) AS ord FROM jsonb_array_elements(config_json->'kpis') WITH ORDINALITY
      UNION ALL
      SELECT '"team_efficiency"'::jsonb,
             COALESCE((SELECT ordinality * 10 + 5 FROM jsonb_array_elements(config_json->'kpis') WITH ORDINALITY WHERE value = '"packing_rate"'::jsonb LIMIT 1), 1000)
    ) t
  )
)
WHERE kind = 'yesterday_kpis'
  AND jsonb_typeof(config_json->'kpis') = 'array'
  AND NOT (config_json->'kpis' @> '["team_efficiency"]'::jsonb);
