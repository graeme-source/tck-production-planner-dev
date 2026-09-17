-- Packing closing check that only appears when orders are actually
-- outstanding (Graeme, 2026-09-17).
--
-- The team were being asked every single day whether there were more orders
-- to dispatch, on a day that usually ended 115/115. A check that is nearly
-- always a no-op teaches people to tick without reading, which is the last
-- thing you want on a closing list.
--
-- The app can answer it: routes/checklists.ts hides any item with this
-- dynamic type when there are no unfulfilled orders on tomorrow's delivery
-- tag, and lists the outstanding ones when there are. Server-side, so the
-- done/total count stays honest.

INSERT INTO checklist_templates (station_type, category, title, description, schedule, order_position, dynamic_data_type, is_active)
SELECT 'packing', 'closing',
       'Orders still to go out',
       'Shown only when orders for tomorrow are still unfulfilled. Pack them, or write in the notes why they are not going.',
       'daily',
       COALESCE((SELECT MAX(order_position) FROM checklist_templates WHERE station_type='packing' AND category='closing'), 0) + 1,
       'outstanding_dispatch_orders',
       true
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_templates
   WHERE station_type='packing' AND dynamic_data_type='outstanding_dispatch_orders'
);
