-- Fried chicken: "FREEZE ON ARRIVAL", not "KEEP FROZEN" (Graeme, 27 Oct
-- 2026). It is delivered chilled on purpose; "Keep frozen" made customers
-- think a chilled delivery was a fault. The band says what to do, and the
-- storage text says chilled is how it should arrive. Objective D.
--
-- Only the "Fried chicken" template, and each part only while it still has
-- the original wording, so anything Graeme has typed in Label design stays.
-- (Numbered 0285 to leave 0280-0284 to other in-flight label work.)

UPDATE product_label_templates
   SET settings = jsonb_set(settings, '{storageBanner,text}', '"FREEZE ON ARRIVAL"'),
       version = version + 1, updated_at = NOW(), updated_by_name = 'Freeze on arrival (release)'
 WHERE lower(trim(name)) = 'fried chicken'
   AND settings -> 'storageBanner' ->> 'text' = 'KEEP FROZEN';

UPDATE product_label_templates
   SET settings = jsonb_set(settings, '{text,storage}',
         to_jsonb('**Delivered chilled** — that''s how it should arrive. Freeze it as soon as it arrives and store at -18°C or below. Cook from frozen.'::text)),
       version = version + 1, updated_at = NOW(), updated_by_name = 'Freeze on arrival (release)'
 WHERE lower(trim(name)) = 'fried chicken'
   AND settings -> 'text' ->> 'storage' = 'Store at -18°C or below. Cook from frozen.';
