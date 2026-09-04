-- Send the day's chicken to Shopify FROM the closing check (Graeme, 2026-09-04).
--
-- 0073 seeded "Submit today's counted bags to Shopify stock" as an ordinary
-- tick-box, which left the closing routine split in two: the check told you to
-- do a thing, and the thing itself lived on the count tab behind a separate
-- button. Whoever is closing had to leave the checklist, find the button, come
-- back and tick. A check that can be ticked without the send having happened is
-- a check that will eventually be ticked without the send having happened.
--
-- Giving it a dynamic_data_type puts the counted figure and the send button on
-- the check itself, the same way the fridge temps and pack batch numbers are
-- recorded on their checks rather than somewhere else.
--
-- The send is unchanged — same endpoint, same manager-or-admin guard, same
-- refusal to send one plan's stock twice. This only changes where you press it.
UPDATE checklist_templates
SET dynamic_data_type = 'fried_chicken_stock_submission'
WHERE station_type = 'fried_chicken'
  AND category = 'closing'
  AND title = 'Submit today''s counted bags to Shopify stock'
  AND dynamic_data_type IS DISTINCT FROM 'fried_chicken_stock_submission';
