-- Pack label: two cooking steps (Graeme, 2026-10-11). Step 3 ("Check
-- they're piping hot throughout before serving.") is removed, and step 1's
-- key words become bold — "some people get that wrong":
--   "Remove the film but **leave the calzones in the wooden tray**."
-- The template's steps also become a list (text.steps) instead of the fixed
-- step1/step2/step3, so 2 steps (or 3 again, if someone adds wording back
-- in Label settings) are drawn and numbered 1..n.
--
-- Same rule as 0162: wording is only changed where it is still the shipped
-- default word for word — a deliberate rewording is carried over as it is.
-- Every saved template moves to the list (the app reads old step1/2/3 too,
-- so this is tidiness, not a requirement). Every live label then shows
-- "Label update needed" until checked and updated — the printed text
-- changes. The live snapshots themselves are not touched.

UPDATE product_label_templates
SET settings = jsonb_set(
      settings #- '{text,step1}' #- '{text,step2}' #- '{text,step3}',
      '{text,steps}',
      COALESCE((
        SELECT jsonb_agg(to_jsonb(v.s) ORDER BY v.i)
        FROM (VALUES
          (1, CASE WHEN settings->'text'->>'step1' = $t$Remove the film but leave the calzones in the wooden tray.$t$
                   THEN $t$Remove the film but **leave the calzones in the wooden tray**.$t$
                   ELSE settings->'text'->>'step1' END),
          (2, settings->'text'->>'step2'),
          (3, CASE WHEN settings->'text'->>'step3' = $t$Check they're piping hot throughout before serving.$t$
                   THEN NULL
                   ELSE settings->'text'->>'step3' END)
        ) AS v(i, s)
        WHERE v.s IS NOT NULL AND btrim(v.s) <> ''
      ), '[]'::jsonb)),
    version = version + 1,
    updated_at = NOW(),
    updated_by_name = 'Two cooking steps update (migration 0163)'
WHERE settings->'text' ? 'step1'
   OR settings->'text' ? 'step2'
   OR settings->'text' ? 'step3';

-- Bigger steps: the steps' largest size goes from 10 pt to 12 pt (they have
-- the whole row between two of them now) — only if it's still the shipped 10.
UPDATE product_label_templates
SET settings = jsonb_set(settings, '{fields,steps,maxPt}', '12'::jsonb),
    version = version + 1,
    updated_at = NOW(),
    updated_by_name = 'Two cooking steps update (migration 0163)'
WHERE (settings->'fields'->'steps'->>'maxPt')::numeric = 10;
