-- Station changes back-fill (Graeme, 27 Oct 2026; objectives E, F and H).
-- The last 30 days of changes, written up from the deploy history and tagged
-- with the area(s) they affect, so "What's changed in this station?" and the
-- grouped meeting slide have content from day one. Three carry walkthroughs
-- (wrapping front/back labels, brownie 5-pack labels, garlic mayo pot labels)
-- and one introduces the new station menu itself.
--
-- Idempotent by slug. Graeme to check the tagging (list in the build report);
-- re-tag any entry on the Station changes page (/station-changes).

INSERT INTO system_updates (slug, title, body, areas, created_at, updated_at, published, tutorial) VALUES

-- ── Station work ─────────────────────────────────────────────────────────
('2026-10-27-wrapping-front-labels', 'Print front labels on Wrapping',
$$Every flavour panel on Wrapping has a Print front labels button beside Print back labels
The front label is the 102 x 25 mm name label: the flavour's name in big type, with an optional short second line
A product with no printed front label (test flavours) shows it as the main green button
Print back labels only shows once a flavour's label is published — otherwise it says "Use Label Live"$$,
'{wrapping}', '2026-10-27 06:37:39', '2026-10-27 06:37:39', true,
$${"steps":[
 {"target":null,"title":"Labels straight from Wrapping","body":"You can now print a flavour's front name label and its back label right here, as you wrap it. No more walking to the office computer or waiting for someone to print them for you."},
 {"target":"wrapping-print-front-labels","title":"Print front labels","body":"Tap this on the flavour you're wrapping. Put in how many you need (it suggests the packs from this run), add a short second line if you want one, and print. Print at Actual size on the 102 x 25 mm label printer.","hiddenNote":"This button is on each flavour's panel in the wrapping queue. It shows for people allowed to print labels."},
 {"target":"wrapping-print-back-labels","title":"Print back labels","body":"Same idea for the back label with the ingredients and allergens. It only shows when the flavour's label has been checked and published. If you see \"Use Label Live\" instead, print that flavour's labels the old way in Label Live.","hiddenNote":"Shows on a flavour's panel once its back label is published."}
]}$$::jsonb),

('2026-10-27-brownie-five-pack-labels', 'Brownie 5-pack labels in one tap',
$$The Desserts card now has "Print all N 5-pack labels" for the delivery day
Each label has the flavour, 5 PACK, a use-by date (14 days unless a manager changes it) and the barcode
"See the labels" shows every label before you print$$,
'{packing}', '2026-10-27 06:51:00', '2026-10-27 06:51:00', true,
$${"steps":[
 {"target":null,"title":"5-pack labels without the faff","body":"Brownie 5-packs need a label with the flavour, a use-by date and the barcode. They used to be written up by hand. Now one tap makes every label for the delivery day."},
 {"target":"five-pack-labels","title":"Print all the 5-pack labels","body":"Tap \"Print all … 5-pack labels\". It opens one PDF with a label for every 5-pack in today's orders. Print it at Actual size on the 102 x 25 mm label printer.","hiddenNote":"This button is on the pink Desserts card when the delivery day has 5-packs to send."},
 {"target":"five-pack-labels-see","title":"Check before you print","body":"\"See the labels\" shows each label and how many of each flavour. If a flavour says \"no barcode\", it still prints, just without one. Tell a manager so the barcode gets added.","hiddenNote":"Next to the print button on the Desserts card."}
]}$$::jsonb),

('2026-10-27-garlic-mayo-pot-labels', 'Garlic mayo pot labels from the iPad',
$$When you finish making TCK Garlic Mayo on Bases & Sauces, the Complete screen shows its pot label
It suggests how many labels the batch fills (200 g pots) — change it to what you actually potted
One Print button: name, use-by (38 days), batch and barcode on every label$$,
'{prep_bases}', '2026-10-27 06:51:00', '2026-10-27 06:51:00', true,
$${"steps":[
 {"target":null,"title":"Pot labels when the mayo is made","body":"TCK Garlic Mayo is sold in pots, and every pot needs a label with the use-by and barcode. The labels now print from this iPad the moment you finish the batch, so they always match the batch you just made."},
 {"target":"prep-bases-pick","title":"Make the batch as normal","body":"Pick TCK Garlic Mayo from the list and make it the usual way: weigh, tick, finish.","hiddenNote":"This is the Bases & Sauces list you pick a sub-recipe from."},
 {"target":"pot-labels","title":"Print the pot labels","body":"On the Complete screen you'll see the pot label. The number is what the batch should fill. Change it with − and + to the pots you actually filled, then tap Print. Print at Actual size on the 102 x 25 mm label printer.","hiddenNote":"This card appears on the Complete! screen after you finish a batch of a sub-recipe we sell in pots, like TCK Garlic Mayo."}
]}$$::jsonb),

('2026-10-23-mixing-padlock-building-started', 'Mixing padlock once building starts',
$$A flavour on the Mixing list now locks (padlock) as soon as building has started it
It can't be dragged to a new place in the order after that, so the builders' order never changes under them$$,
'{mixing}', '2026-10-23 05:00:07', '2026-10-23 05:00:07', true, NULL),

('2026-10-23-stock-checks-blind', 'Stock checks stay blind',
$$The "Are you sure?" check on a stock count no longer shows the figure we expected
Count what's really there — the system checks it, you don't need to match a number$$,
'{prep}', '2026-10-23 07:10:00', '2026-10-23 07:10:00', true, NULL),

('2026-10-22-prep-four-tabs', 'Prep screens: four big tabs',
$$Prep now has four big tabs: Main Prep, Bases & Sauces, Raw Meat and Stock Check
Each tab shows its progress under its name ("12 of 18 done")
The Stock Check tab turns amber when checks are outstanding and flashes red near the deadline$$,
'{prep}', '2026-10-22 13:09:43', '2026-10-22 13:09:43', true, NULL),

('2026-10-22-stock-check-five-minute-warning', 'Stock check due in 5 minutes',
$$Five minutes before the stock-check deadline, a pop-up lists the items still to count
Tap an item to count it straight away, or "I'm aware, carry on" to close it$$,
'{prep}', '2026-10-22 12:59:42', '2026-10-22 12:59:42', true, NULL),

('2026-10-22-stock-check-use-by', 'Use-by date on stock checks',
$$Items marked "Require use-by date" now ask for the use-by when you count them
You'll get a warning if the use-by is today or already passed$$,
'{prep}', '2026-10-22 13:39:48', '2026-10-22 13:39:48', true, NULL),

('2026-10-22-bases-who-is-viewing', 'Bases & Sauces shows who else is on an item',
$$Like Main Prep, Bases & Sauces now marks an item someone else is already viewing
Saves two people making the same sauce$$,
'{prep_bases}', '2026-10-22 12:30:00', '2026-10-22 12:30:00', true, NULL),

('2026-10-22-prep-labels-redesign', 'Prep labels easier to read',
$$Prep labels now show the item name big, and the USE BY date large on a black bar
Raw items get a black RAW tag; opened date and initials sit small at the bottom
No label rule set for an ingredient means no label (no more 2-day guess)$$,
'{prep}', '2026-10-22 11:00:00', '2026-10-22 11:00:00', true, NULL),

('2026-10-22-break-note', 'Note on a break',
$$The break screen has an "Anything to note?" box, for example "called back for APC"
It saves as you type and shows Saving / Saved$$,
'{all_stations}', '2026-10-22 13:03:30', '2026-10-22 13:03:30', true, NULL),

('2026-10-22-dough-separate-checklists', 'Dough Prep and Sheeting have their own checklists',
$$Dough Prep no longer shares Dough Sheeting's checklist
The dough-mix checks moved to Dough Prep; sheeting checks stay on Sheeting$$,
'{dough_prep,dough_sheeting}', '2026-10-22 12:20:00', '2026-10-22 12:20:00', true, NULL),

('2026-10-22-mixing-builders-progress', 'Mixing shows how far the builders are',
$$Each flavour on the Mixing queue now says how far building has got, e.g. "Builders: 6 of 13 built · 7 left"$$,
'{mixing}', '2026-10-22 12:10:00', '2026-10-22 12:10:00', true, NULL),

('2026-10-22-mac-cheese-re-record-temp', 'Re-record a temperature on Macaroni Cheese',
$$A recorded temperature (pigs in blankets cook, both sauce checks) now has a Re-record button
It saves a new reading and the screen shows the latest; the first one stays in the log$$,
'{macaroni_cheese}', '2026-10-22 12:49:13', '2026-10-22 12:49:13', true, NULL),

('2026-10-22-ovens-mac-cheese-chilled', 'Ovens: mac cheese Mark as Chilled wakes up by itself',
$$Mark as Chilled for mac cheese now appears without reloading the screen
When everything from building is in, the tray button says "All packs in"$$,
'{ovens,macaroni_cheese}', '2026-10-22 12:15:00', '2026-10-22 12:15:00', true, NULL),

('2026-10-22-front-door-call-strip', 'Delivery cards: call the supplier in one tap',
$$Each Front Door delivery card shows the supplier's phone number (tap to call) and our account number with a Copy button$$,
'{goods_in}', '2026-10-22 12:00:00', '2026-10-22 12:00:00', true, NULL),

('2026-10-21-report-defect-something-else', 'Report defect: "Something else…" asks what went wrong',
$$"Something else…" is always the last reason and opens a box to say what went wrong
You can type or dictate it (200 characters)$$,
'{all_stations}', '2026-10-21 08:37:13', '2026-10-21 08:37:13', true, NULL),

('2026-10-21-packing-cancelled-labels', 'Packing: labels for cancelled orders',
$$A label booked for an order that was later cancelled in Shopify now shows "Cancelled in Shopify — cancel this label"
Cancelling the label takes two taps; nothing is cancelled automatically$$,
'{packing}', '2026-10-21 10:00:00', '2026-10-21 10:00:00', true, NULL),

('2026-10-19-stock-check-two-steps', 'Stock check is two steps on every prep screen',
$$Every item has "Record stock check for this item"
Step 1 tells you the unit to count in; step 2 is one big number box with Dictate
It reads back what you saved and double-checks a count that's far off the usual$$,
'{prep}', '2026-10-19 11:00:00', '2026-10-19 11:00:00', true, NULL),

('2026-10-19-packing-chargeback-banner', 'Packing: orders held for a chargeback',
$$A red "order held — open chargeback" banner shows on the pack list and the packing station
Held orders are hidden from the queue; tap the banner to see which and why — do not send them$$,
'{packing}', '2026-10-19 12:00:00', '2026-10-19 12:00:00', true, NULL),

('2026-10-19-wrapping-use-label-live', 'Wrapping: "Use Label Live" for unpublished labels',
$$A flavour without a published label shows the instruction "Use Label Live" instead of a print button$$,
'{wrapping}', '2026-10-19 10:00:00', '2026-10-19 10:00:00', true, NULL),

('2026-10-19-bun-dough-billets', 'Bun dough is weighed the day before',
$$Bun dough is weighed up the day before ("weigh up for tomorrow" card) and mixed on the production morning
It's portioned into billets, so it no longer appears in the balling count$$,
'{dough_prep}', '2026-10-19 09:00:00', '2026-10-19 09:00:00', true, NULL),

('2026-10-16-wrapping-buns-freezer', 'Wrapping: cinnamon buns go to the freezer',
$$Buns come onto the normal wrap list straight from building (they skip the ovens)
They go to the freezer by default and each wrap adds them to the shop, with a status you can see and retry$$,
'{wrapping,building}', '2026-10-16 12:00:00', '2026-10-16 12:00:00', true, NULL),

('2026-10-16-goods-in-shelf-life-damage', 'Goods-in: short shelf life, damage and photos',
$$A big red warning shows when a delivery's use-by is shorter than we accept — choose Accept anyway or Reject
Every line has "Damaged / broken?"; problem items need a photo before you finish
The supplier gets one email with the photos$$,
'{goods_in}', '2026-10-16 11:00:00', '2026-10-16 11:00:00', true, NULL),

('2026-10-15-count-alarm-pinned', 'Count alarm pinned to the top of the screen',
$$The Factory Number count reminder now sits at the top of Wrapping and Order Packing Live, even when you scroll
It flashes red as the deadline nears, then shows OVERDUE until the count is done$$,
'{wrapping,packing}', '2026-10-15 13:00:00', '2026-10-15 13:00:00', true, NULL),

('2026-10-24-smart-add', 'One smart add box on lists, to-dos and checklists',
$$Type or dictate one line and it's filed in the right place on team lists, to-dos and checklists$$,
'{all_stations,planning}', '2026-10-24 10:00:00', '2026-10-24 10:00:00', true, NULL),

-- ── Production planning ──────────────────────────────────────────────────
('2026-10-23-meeting-prep-reminders', 'Morning meeting: standing reminders',
$$The meeting prep page is full width with Start always visible, and has standing reminders that show every day$$,
'{planning}', '2026-10-23 08:00:00', '2026-10-23 08:00:00', true, NULL),

('2026-10-22-orders-still-to-prep', 'Orders: "still to prep" counts prep tins and trays',
$$The Orders page's "still to prep" now counts what the prep station has already made into tins and trays$$,
'{planning}', '2026-10-22 09:00:00', '2026-10-22 09:00:00', true, NULL),

('2026-10-16-create-plan-capacity', 'Create Plan capacity in batch equivalents',
$$Create Plan counts capacity in calzone-batch equivalents, with buns in packs
Recipes have a "Production route" panel (skip ovens, freezer, shop on wrap)$$,
'{planning}', '2026-10-16 10:00:00', '2026-10-16 10:00:00', true, NULL),

('2026-10-15-create-plan-no-duplicates', 'Create Plan can''t make the same plan twice',
$$A double tap on Create Plan no longer makes two identical plans (which doubled every prep and order figure)$$,
'{planning}', '2026-10-15 10:00:00', '2026-10-15 10:00:00', true, NULL),

-- ── Office (never shown in the meeting) ──────────────────────────────────
('2026-10-11-roas-cards', 'ROAS cards and targets',
$$At a Glance ROAS cards show the window in the title and colour the trend against target; founder can set the targets$$,
'{office}', '2026-10-11 10:00:00', '2026-10-11 10:00:00', true, NULL),

('2026-10-01-marketing-calendar-notes', 'Marketing calendar notes and to-dos',
$$Tap a day on the marketing calendar to add a note or a to-do; phases show as pale bands$$,
'{office}', '2026-10-01 10:00:00', '2026-10-01 10:00:00', true, NULL)

ON CONFLICT (slug) DO NOTHING;

-- The new station menu itself, dated when this ships so it's "new" for
-- everyone on deploy day.
INSERT INTO system_updates (slug, title, body, areas, published, tutorial) VALUES
('station-menu-whats-changed', 'Station menu and "What''s changed?"',
$$The things you need now and then (contacts, SOPs, add an SOP) are in one Station menu button at the top right
"What's changed in this station?" in that menu lists the last 7 days of changes for this station
A number on the menu button shows changes you haven't seen yet; tap one to see how to use it$$,
'{all_stations}', true,
$${"steps":[
 {"target":"station-menu","title":"The Station menu","body":"Everything you need now and then for this station lives here: contacts, the SOP library and adding an SOP. The number on it is how many changes to this station you haven't seen yet."},
 {"target":null,"title":"What's changed in this station?","body":"Open the menu and tap \"What's changed in this station?\" to see what's new here in the last 7 days. Tap a change with \"Show me\" and it walks you through it on this screen, like this."},
 {"target":null,"title":"That's it","body":"Each change stays marked NEW until you've looked at it. Check the menu when you start your shift."}
]}$$::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- Existing hand-written entries from the last 30 days (no slug, not yet
-- tagged): best guess from their words using change_areas.word_hints. Left
-- untagged when nothing matches — they then stay off the station screens and
-- out of the station-grouped slide until someone tags them.
UPDATE system_updates su
   SET areas = g.keys
  FROM (
    SELECT s.id, array_agg(ca.key ORDER BY ca.sort_order) AS keys
      FROM system_updates s
      JOIN change_areas ca ON EXISTS (
        SELECT 1 FROM unnest(ca.word_hints) w
         WHERE (coalesce(s.title, '') || ' ' || s.body)
               ~* ('(^|[^a-z0-9])' || regexp_replace(w, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '($|[^a-z0-9])')
      )
     WHERE s.slug IS NULL
       AND s.areas = '{}'
       AND s.created_at >= now() - interval '30 days'
     GROUP BY s.id
  ) g
 WHERE su.id = g.id;
