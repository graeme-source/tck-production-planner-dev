-- The Packing/Wrapping checklist item that signs off today's Factory Number
-- count (Graeme, 24 Nov 2026): ticking it stands down the 3pm "count due"
-- reminder, and opening it shows today's count. The code finds the item by
-- this type, never by its wording; this one-off step gives the existing
-- "Update factory number by 3pm" item the type. Others can be set in the
-- checklist editor. Idempotent.
UPDATE checklist_templates
   SET dynamic_data_type = 'factory_number_count'
 WHERE station_type IN ('packing', 'wrapping')
   AND dynamic_data_type IS NULL
   AND title ILIKE '%factory number%';
