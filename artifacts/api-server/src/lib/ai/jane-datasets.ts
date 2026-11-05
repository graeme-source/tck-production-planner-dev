import type { Dataset, DatasetColumn } from "./jane-data-query";

// Everything AI Jane can read beyond her own lookups (Graeme, 5 Nov 2026): the
// operational records anyone could count up by opening the app under their own
// login. This is an allow-list. A table or column that isn't written here can't
// be read, so nothing new reaches her until someone adds it on purpose.
//
// Never add: finance, anything founder-only, the People section, private
// records, customer details, secrets (jane-datasets.test.ts fails if a dataset
// touches them). Per-person figures stay out too: the only staff name here is
// who suggested an improvement, which the open Improvements page already shows.
//
// `pageKey` is the page whose permission gates the data. `minRole` is a floor
// for data on a page where only some tabs are open: viewers can open Reports,
// but only its Issue Log. Expected (running) stock is deliberately absent:
// counts stay blind, and managers read it on Stock accuracy.

export type JaneDataset = Dataset & { minRole?: "manager" };

/** A stored UTC timestamp as the London day it happened on. */
const londonDay = (column: string) => `(${column} AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London')::date`;
/** The same, as a clock time. */
const londonTime = (column: string) => `to_char(${column} AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'HH24:MI')`;
const minutesBetween = (from: string, to: string) => `(EXTRACT(EPOCH FROM (${to} - ${from})) / 60)::float8`;

const text = (name: string, about?: string): DatasetColumn => ({ name, type: "text", about });
const num = (name: string, about?: string): DatasetColumn => ({ name, type: "number", about });
const date = (name: string, about?: string): DatasetColumn => ({ name, type: "date", about });
const yes = (name: string, about?: string): DatasetColumn => ({ name, type: "boolean", about });

/** A stock_entries row written by goods-in or a transfer, not a count. Same
 *  wording as isSystemStockNote in lib/stock-ledger.ts. */
const NOT_A_MOVEMENT = `(se.notes IS NULL OR se.notes !~ '^(Delivery from PO #|Undo delivery PO #|Transfer (in|out) )')`;

export const JANE_DATASETS: JaneDataset[] = [
  // ── Production ─────────────────────────────────────────────────────────
  {
    name: "production_plans",
    about: "One row per production plan: its dates and status.",
    pageKey: "/plans",
    sql: `SELECT pp.plan_date, pp.prep_date, pp.dough_date, pp.name AS plan_name, pp.status, pp.batch_number::float8 AS batch_number
          FROM production_plans pp`,
    columns: [date("plan_date", "production day"), date("prep_date"), date("dough_date"), text("plan_name"), text("status", "active or complete"), num("batch_number")],
  },
  {
    name: "production_by_recipe",
    about: "What was planned and really made, one row per recipe per plan. The place for batches and packs over any period.",
    pageKey: "/plans",
    // batches_complete is NOT what was made: only fried chicken moves it. Built
    // batches are the station's own completions, and good packs are what was
    // counted at wrapping (countedGoodPacks in lib/team-efficiency-day.ts).
    sql: `SELECT pp.plan_date, r.name AS recipe, r.category, pp.status AS plan_status,
                 pi.batches_target::float8 AS batches_planned, COALESCE(b.built, 0)::float8 AS batches_built,
                 (COALESCE(pi.fridge_qty, 0) + CASE WHEN r.default_storage = 'freezer' THEN COALESCE(pi.freezer_qty, 0) ELSE 0 END)::float8 AS good_packs,
                 COALESCE(pi.wonly_total, 0)::float8 AS wonkies, COALESCE(pi.dog_bin_count, 0)::float8 AS dog_bins,
                 COALESCE(pi.eight_pack_bag_count, 0)::float8 AS eight_pack_bags, pi.tin_size
          FROM production_plan_items pi
          JOIN production_plans pp ON pp.id = pi.plan_id
          JOIN recipes r ON r.id = pi.recipe_id
          LEFT JOIN (
            SELECT bc.plan_item_id,
                   SUM(CASE WHEN bc.partial_packs IS NULL THEN 1
                            ELSE bc.partial_packs * COALESCE(NULLIF(rr.pack_size, 0), 1) / COALESCE(NULLIF(rr.portions_per_batch, 0), 10)::float8 END) AS built
            FROM batch_completions bc
            JOIN production_plan_items ii ON ii.id = bc.plan_item_id
            JOIN recipes rr ON rr.id = ii.recipe_id
            WHERE bc.station_type IN ('building_1', 'building_2', 'fried_chicken')
            GROUP BY bc.plan_item_id
          ) b ON b.plan_item_id = pi.id`,
    columns: [
      date("plan_date", "production day"), text("recipe"), text("category"), text("plan_status"),
      num("batches_planned"), num("batches_built", "batches finished at building"),
      num("good_packs", "good packs counted into the fridge at wrapping, not including 8-pack bags"),
      num("wonkies", "packs"), num("dog_bins", "packs, thrown away"), num("eight_pack_bags", "bags"), text("tin_size"),
    ],
  },
  {
    name: "station_batches",
    about: "Every batch finished at a station. Count rows for batches per station or per day; min and max of finished_time give a day's first and last.",
    pageKey: "/plans",
    sql: `SELECT ${londonDay("bc.completed_at")} AS day, bc.station_type AS station, r.name AS recipe, r.category,
                 ${londonTime("bc.completed_at")} AS finished_time,
                 bc.partial_packs::float8 AS partial_packs, bc.partial_packs IS NULL AS full_batch
          FROM batch_completions bc
          JOIN production_plan_items pi ON pi.id = bc.plan_item_id
          JOIN recipes r ON r.id = pi.recipe_id
          WHERE bc.completed_at IS NOT NULL`,
    columns: [
      date("day"), text("station", "building_1, building_2, mixing, ovens, dough_prep, dough_sheeting, fried_chicken"),
      text("recipe"), text("category"), text("finished_time"),
      num("partial_packs", "packs when it wasn't a full batch"), yes("full_batch"),
    ],
  },
  {
    name: "prep_ticks",
    about: "Every tin or tray ticked off at prep: what was prepped, for which recipe, on which day.",
    pageKey: "/plans",
    sql: `SELECT ${londonDay("pc.completed_at")} AS day, pp.plan_date, r.name AS recipe,
                 i.name AS ingredient, sr.name AS sub_recipe, pc.tin_number::float8 AS tin_number
          FROM prep_completions pc
          JOIN production_plans pp ON pp.id = pc.plan_id
          LEFT JOIN recipes r ON r.id = pc.recipe_id
          LEFT JOIN ingredients i ON i.id = pc.ingredient_id
          LEFT JOIN sub_recipes sr ON sr.id = pc.sub_recipe_id`,
    columns: [date("day", "when it was ticked"), date("plan_date", "the production day it's for"), text("recipe"), text("ingredient"), text("sub_recipe"), num("tin_number")],
  },
  {
    name: "sub_recipes_made",
    about: "Sub-recipes marked as made at prep. Count rows: no quantity is recorded.",
    pageKey: "/plans",
    sql: `SELECT ${londonDay("src.completed_at")} AS day, sr.name AS sub_recipe
          FROM sub_recipe_completions src JOIN sub_recipes sr ON sr.id = src.sub_recipe_id`,
    columns: [date("day"), text("sub_recipe")],
  },
  {
    name: "oven_trays",
    about: "Trays in and out of the ovens.",
    pageKey: "/plans",
    sql: `SELECT ${londonDay("oe.oven_in_at")} AS day, COALESCE(oe.recipe_name, oe.ingredient_name) AS item,
                 oe.tray_index::float8 AS tray, ${londonTime("oe.oven_in_at")} AS in_time, ${londonTime("oe.oven_out_at")} AS out_time,
                 ${minutesBetween("oe.oven_in_at", "oe.oven_out_at")} AS minutes_in_oven
          FROM oven_events oe`,
    columns: [date("day"), text("item"), num("tray"), text("in_time"), text("out_time"), num("minutes_in_oven")],
  },
  {
    name: "wonky_and_dog_bin_taps",
    about: "Each wonky or dog bin tap at a station. +1 adds one, -1 takes one back, so sum delta. For daily totals per recipe use production_by_recipe.",
    pageKey: "/plans",
    sql: `SELECT ${londonDay("q.created_at")} AS day, q.kind, q.delta::float8 AS delta, q.station_type AS station, r.name AS recipe
          FROM quality_reject_events q LEFT JOIN recipes r ON r.id = q.recipe_id`,
    columns: [date("day"), text("kind", "wonky or dog_bin"), num("delta", "packs"), text("station"), text("recipe")],
  },
  {
    name: "finished_stock_moves",
    about: "Every change to finished packs in the fridge and freezer. source: wrapping = packs wrapped, fulfilment = packs sent, freeze, manual.",
    pageKey: "/plans",
    sql: `SELECT ${londonDay("f.created_at")} AS day, r.name AS recipe, f.source, f.location, f.delta::float8 AS packs_change,
                 f.resulting_qty::float8 AS packs_after, f.pack_size::float8 AS pack_size
          FROM fridge_stock_changes f LEFT JOIN recipes r ON r.id = f.recipe_id`,
    columns: [date("day"), text("recipe"), text("source"), text("location"), num("packs_change", "packs, minus when they left"), num("packs_after"), num("pack_size")],
  },
  {
    name: "finished_stock_by_use_by",
    about: "Finished packs by batch number and use-by date.",
    pageKey: "/plans",
    sql: `SELECT r.name AS recipe, b.batch_number::float8 AS batch_number, b.quantity::float8 AS packs, b.use_by_date, b.pack_size::float8 AS pack_size
          FROM fridge_stock_batches b JOIN recipes r ON r.id = b.recipe_id`,
    columns: [text("recipe"), num("batch_number"), num("packs"), date("use_by_date"), num("pack_size")],
  },
  {
    name: "queued_production",
    about: "Production queued for future days, not yet on a plan.",
    pageKey: "/plans",
    sql: `SELECT q.production_date, r.name AS recipe, q.batches::float8 AS batches, q.status
          FROM queued_production q JOIN recipes r ON r.id = q.recipe_id`,
    columns: [date("production_date"), text("recipe"), num("batches"), text("status")],
  },
  {
    name: "timing_standards",
    about: "The target batches per hour for each station.",
    pageKey: "/plans",
    sql: `SELECT t.station_label AS station, t.min_batches_per_hour::float8 AS minimum_per_hour, t.target_batches_per_hour::float8 AS target_per_hour
          FROM timing_standards t`,
    columns: [text("station"), num("minimum_per_hour"), num("target_per_hour")],
  },

  // ── Recipes and ingredients ────────────────────────────────────────────
  {
    name: "recipes",
    about: "Every recipe: category, sizes, shelf life and whether it's on the menu.",
    pageKey: "/recipes",
    sql: `SELECT r.name AS recipe, r.category, r.portions_per_batch::float8 AS portions_per_batch, r.pack_size::float8 AS pack_size,
                 r.shelf_life_days::float8 AS shelf_life_days, r.rrp::float8 AS rrp, r.is_core_menu AS core_menu, r.is_current_special AS current_special,
                 CASE WHEN r.archived_at IS NOT NULL THEN 'archived' WHEN r.is_draft THEN 'draft' ELSE 'live' END AS state
          FROM recipes r`,
    columns: [text("recipe"), text("category"), num("portions_per_batch"), num("pack_size", "portions in a pack"), num("shelf_life_days"), num("rrp", "£"), yes("core_menu"), yes("current_special"), text("state", "live, draft or archived")],
  },
  {
    name: "recipe_ingredients",
    about: "Which recipes use which ingredients and sub-recipes, for 'what uses X'. Quantities are per portion, cooked.",
    pageKey: "/recipes",
    sql: `SELECT r.name AS recipe, i.name AS item, 'ingredient' AS kind, ri.quantity::float8 AS quantity_per_portion, i.unit, ri.is_topping, ri.include_in_filling_mix AS in_filling_mix,
                 CASE WHEN r.archived_at IS NOT NULL THEN 'archived' WHEN r.is_draft THEN 'draft' ELSE 'live' END AS recipe_state
          FROM recipe_ingredients ri JOIN recipes r ON r.id = ri.recipe_id JOIN ingredients i ON i.id = ri.ingredient_id
          UNION ALL
          SELECT r.name, sr.name, 'sub_recipe', rs.quantity::float8, sr.yield_unit, false, rs.include_in_filling_mix,
                 CASE WHEN r.archived_at IS NOT NULL THEN 'archived' WHEN r.is_draft THEN 'draft' ELSE 'live' END
          FROM recipe_sub_recipes rs JOIN recipes r ON r.id = rs.recipe_id JOIN sub_recipes sr ON sr.id = rs.sub_recipe_id`,
    columns: [text("recipe"), text("item"), text("kind", "ingredient or sub_recipe"), num("quantity_per_portion"), text("unit"), yes("is_topping"), yes("in_filling_mix"), text("recipe_state", "live, draft or archived")],
  },
  {
    name: "sub_recipe_ingredients",
    about: "What goes into each sub-recipe, per its stated yield.",
    pageKey: "/sub-recipes",
    sql: `SELECT sr.name AS sub_recipe, i.name AS item, 'ingredient' AS kind, si.quantity::float8 AS quantity, i.unit, sr.yield::float8 AS yield, sr.yield_unit
          FROM sub_recipe_ingredients si JOIN sub_recipes sr ON sr.id = si.sub_recipe_id JOIN ingredients i ON i.id = si.ingredient_id
          UNION ALL
          SELECT sr.name, c.name, 'sub_recipe', ss.quantity::float8, c.yield_unit, sr.yield::float8, sr.yield_unit
          FROM sub_recipe_sub_recipes ss JOIN sub_recipes sr ON sr.id = ss.sub_recipe_id JOIN sub_recipes c ON c.id = ss.component_sub_recipe_id`,
    columns: [text("sub_recipe"), text("item"), text("kind", "ingredient or sub_recipe"), num("quantity"), text("unit"), num("yield"), text("yield_unit")],
  },
  {
    name: "ingredients",
    about: "Every ingredient: category, unit, pack size, price, supplier, shelf life, and how it's stock-checked or reordered.",
    pageKey: "/ingredients",
    sql: `SELECT i.name AS ingredient, i.category, i.unit, i.pack_weight::float8 AS pack_size, i.cost_per_pack::float8 AS cost_per_pack,
                 s.name AS supplier, i.shelf_life_days::float8 AS shelf_life_days, i.stock_check_enabled AS stock_checked, i.kanban_enabled AS kanban
          FROM ingredients i LEFT JOIN suppliers s ON s.id = i.supplier_id`,
    columns: [text("ingredient"), text("category"), text("unit"), num("pack_size", "in the ingredient's unit"), num("cost_per_pack", "£"), text("supplier"), num("shelf_life_days"), yes("stock_checked"), yes("kanban")],
  },

  // ── Ordering and deliveries ────────────────────────────────────────────
  {
    name: "purchase_orders",
    about: "Orders placed with suppliers, one row per order line: what was ordered and what arrived.",
    pageKey: "/orders",
    sql: `SELECT po.id::float8 AS order_number, s.name AS supplier, po.status, ${londonDay("po.placed_at")} AS placed_on, po.expected_delivery_date,
                 COALESCE(i.name, l.description) AS item, l.quantity_ordered::float8 AS quantity_ordered, l.quantity_received::float8 AS quantity_received,
                 l.unit, l.unit_price::float8 AS unit_price, l.use_by_date
          FROM purchase_order_lines l
          JOIN purchase_orders po ON po.id = l.purchase_order_id
          LEFT JOIN suppliers s ON s.id = po.supplier_id
          LEFT JOIN ingredients i ON i.id = l.ingredient_id`,
    columns: [num("order_number"), text("supplier"), text("status"), date("placed_on"), date("expected_delivery_date"), text("item"), num("quantity_ordered"), num("quantity_received"), text("unit", "read this: packs and weights both appear"), num("unit_price", "£"), date("use_by_date")],
  },
  {
    name: "deliveries",
    about: "Deliveries received: supplier, day and goods-in temperatures.",
    pageKey: "/deliveries",
    sql: `SELECT ${londonDay("d.received_at")} AS day, s.name AS supplier, d.chilled_temp_c::float8 AS chilled_temp_c, d.frozen_temp_c::float8 AS frozen_temp_c,
                 d.all_put_away, d.invoice_filed
          FROM delivery_records d LEFT JOIN suppliers s ON s.id = d.supplier_id`,
    columns: [date("day"), text("supplier"), num("chilled_temp_c"), num("frozen_temp_c"), yes("all_put_away"), yes("invoice_filed")],
  },
  {
    name: "kanbans",
    about: "Kanban cards and when they were pulled.",
    pageKey: "/orders",
    sql: `SELECT i.name AS ingredient, s.name AS supplier, k.status, ${londonDay("k.pulled_at")} AS pulled_on, k.order_day_target
          FROM kanban_items k LEFT JOIN ingredients i ON i.id = k.ingredient_id LEFT JOIN suppliers s ON s.id = k.supplier_id`,
    columns: [text("ingredient"), text("supplier"), text("status"), date("pulled_on"), date("order_day_target")],
  },
  {
    name: "suppliers",
    about: "Suppliers and when they can be ordered from. No contact details.",
    pageKey: "/suppliers",
    sql: `SELECT s.name AS supplier, s.order_frequency, s.order_days, s.lead_time_days::float8 AS lead_time_days, s.cutoff_time::text AS cutoff_time,
                 s.minimum_order_value::float8 AS minimum_order_value, s.order_by_email
          FROM suppliers s`,
    columns: [text("supplier"), text("order_frequency"), text("order_days"), num("lead_time_days"), text("cutoff_time"), num("minimum_order_value", "£"), yes("order_by_email")],
  },
  {
    name: "stock_counts",
    about: "Stock counted by people, latest last. These are real counts, not expected stock.",
    pageKey: "/stock",
    sql: `SELECT ${londonDay("se.checked_at")} AS day, ${londonTime("se.checked_at")} AS time, i.name AS ingredient, se.location, se.quantity::float8 AS quantity, se.unit, se.use_by_date
          FROM stock_entries se JOIN ingredients i ON i.id = se.ingredient_id
          WHERE se.item_type = 'ingredient' AND ${NOT_A_MOVEMENT}`,
    columns: [date("day"), text("time"), text("ingredient"), text("location"), num("quantity"), text("unit"), date("use_by_date")],
  },

  // ── Sales and dispatch ─────────────────────────────────────────────────
  {
    name: "orders_by_product",
    about: "Units on Shopify orders, one row per product on an order. No prices and no customer details. Exclude cancelled orders unless asked. Count distinct order_id for orders.",
    pageKey: "/dispatches",
    sql: `SELECT o.id::float8 AS order_id, (o.created_at AT TIME ZONE 'Europe/London')::date AS order_day,
                 substring(o.payload->>'tags' from '20[0-9]{2}-[01][0-9]-[0-3][0-9]')::date AS delivery_date,
                 li->>'title' AS product, li->>'variant_title' AS variant, (li->>'quantity')::float8 AS quantity,
                 o.payload->>'cancelled_at' IS NOT NULL AS cancelled, COALESCE(o.payload->>'fulfillment_status', 'unfulfilled') AS fulfilment
          FROM shopify_orders_cache o CROSS JOIN LATERAL jsonb_array_elements(o.payload->'line_items') AS li`,
    columns: [num("order_id"), date("order_day", "day the customer ordered"), date("delivery_date", "the despatch is the day before"), text("product"), text("variant"), num("quantity", "units as sold: a 2-pack is one"), yes("cancelled"), text("fulfilment")],
  },
  {
    name: "parcels",
    about: "APC parcels booked: one row per consignment. No customer names or addresses.",
    pageKey: "/fulfilment",
    sql: `SELECT a.shopify_order_name AS order_name, a.waybill, a.collection_date, a.dispatch_tag, a.apc_status,
                 ${londonDay("a.label_printed_at")} AS label_printed_on, a.cancelled_at IS NOT NULL AS cancelled, a.superseded_at IS NOT NULL AS replaced
          FROM apc_consignments a`,
    columns: [text("order_name"), text("waybill"), date("collection_date"), text("dispatch_tag"), text("apc_status"), date("label_printed_on"), yes("cancelled"), yes("replaced")],
  },

  // ── Quality and food safety ────────────────────────────────────────────
  {
    name: "checklists_done",
    about: "Checklists completed or skipped, by day.",
    pageKey: "/plans",
    sql: `SELECT ${londonDay("c.completed_at")} AS day, ${londonTime("c.completed_at")} AS time, t.title AS checklist, t.category, c.station_type AS station, c.skipped_reason
          FROM checklist_completions c LEFT JOIN checklist_templates t ON t.id = c.template_id`,
    columns: [date("day"), text("time"), text("checklist"), text("category"), text("station"), text("skipped_reason", "empty when it was done")],
  },
  {
    name: "checklist_list",
    about: "The checklists that exist and how often they're due.",
    pageKey: "/plans",
    sql: `SELECT t.title AS checklist, t.station_type AS station, t.category, t.schedule, t.schedule_days, t.is_active AS active FROM checklist_templates t`,
    columns: [text("checklist"), text("station"), text("category"), text("schedule"), text("schedule_days"), yes("active")],
  },
  {
    name: "issues",
    about: "Issues reported on the floor, from the Issue Log.",
    pageKey: "/reports",
    sql: `SELECT ${londonDay("a.created_at")} AS day, a.category::text AS category, a.severity::text AS severity, a.description, a.station, a.area,
                 a.acknowledged_at IS NOT NULL AS acknowledged, a.resolved_at IS NOT NULL AS resolved, ${londonDay("a.resolved_at")} AS resolved_on
          FROM andon_issues a`,
    columns: [date("day"), text("category"), text("severity", "red, yellow or green"), text("description"), text("station"), text("area"), yes("acknowledged"), yes("resolved"), date("resolved_on")],
  },
  {
    name: "improvements",
    about: "Improvement ideas and how far along they are.",
    pageKey: "/improvements",
    sql: `SELECT ${londonDay("i.created_at")} AS day, i.title, i.description, i.station, i.type, i.progress_status::text AS progress, i.approval_tier::text AS approval,
                 i.submitted_by_name AS suggested_by, ${londonDay("i.done_at")} AS done_on
          FROM improvement_submissions i`,
    columns: [date("day"), text("title"), text("description"), text("station"), text("type"), text("progress"), text("approval"), text("suggested_by"), date("done_on")],
  },
  {
    name: "waste",
    about: "Defects and waste recorded by hand. Wonkies and dog bins are in production_by_recipe.",
    pageKey: "/analytics/defects",
    sql: `SELECT d.occurred_on AS day, t.name AS defect_type, d.item_kind, COALESCE(r.name, i.name, sr.name, d.item_name) AS item, d.packs::float8 AS packs,
                 d.quantity::float8 AS quantity, d.quantity_unit AS unit, d.station, d.ingredient_cost::float8 AS ingredient_cost, d.reason_other AS reason
          FROM defects d
          LEFT JOIN defect_types t ON t.id = d.defect_type_id
          LEFT JOIN recipes r ON r.id = d.recipe_id
          LEFT JOIN ingredients i ON i.id = d.ingredient_id
          LEFT JOIN sub_recipes sr ON sr.id = d.sub_recipe_id
          WHERE d.deleted_at IS NULL`,
    columns: [date("day"), text("defect_type"), text("item_kind", "ingredient, sub_recipe or product"), text("item"), num("packs"), num("quantity"), text("unit"), text("station"), num("ingredient_cost", "£"), text("reason")],
  },
  {
    name: "fridge_temperatures",
    about: "Sensor readings for the fridges and freezers, last three months. Filter by day and summarise: there are many rows.",
    pageKey: "/reports",
    minRole: "manager",
    sql: `SELECT ${londonDay("g.recorded_at")} AS day, ${londonTime("g.recorded_at")} AS time, s.name AS sensor, g.temperature_c::float8 AS temperature_c
          FROM govee_readings g JOIN govee_sensors s ON s.device = g.device
          WHERE g.recorded_at > now() - interval '92 days' AND g.temperature_c IS NOT NULL`,
    columns: [date("day"), text("time"), text("sensor"), num("temperature_c")],
  },
  {
    name: "storage_temperature_checks",
    about: "Opening and closing temperatures recorded by hand for each storage location.",
    pageKey: "/reports",
    minRole: "manager",
    sql: `SELECT pp.plan_date AS day, l.name AS location, t.opening_temperature_c::float8 AS opening_c, t.closing_temperature_c::float8 AS closing_c,
                 l.temp_min_c::float8 AS allowed_min_c, l.temp_max_c::float8 AS allowed_max_c
          FROM location_temperature_records t
          JOIN storage_locations l ON l.id = t.storage_location_id
          JOIN production_plans pp ON pp.id = t.plan_id`,
    columns: [date("day"), text("location"), num("opening_c"), num("closing_c"), num("allowed_min_c"), num("allowed_max_c")],
  },
  {
    name: "cooked_temperatures",
    about: "Cooked core temperatures recorded at the ovens and stations. The right temperature varies by meat and setting.",
    pageKey: "/reports",
    minRole: "manager",
    sql: `SELECT ${londonDay("t.recorded_at")} AS day, ${londonTime("t.recorded_at")} AS time, COALESCE(t.recipe_name, t.ingredient_name) AS item, t.record_type,
                 t.temperature_c::float8 AS temperature_c, t.held_for_seconds::float8 AS held_for_seconds, t.tray_index::float8 AS tray
          FROM temperature_records t`,
    columns: [date("day"), text("time"), text("item"), text("record_type"), num("temperature_c"), num("held_for_seconds"), num("tray")],
  },
  {
    name: "batch_weights",
    about: "Weights recorded after the ovens against target.",
    pageKey: "/reports",
    minRole: "manager",
    sql: `SELECT ${londonDay("w.recorded_at")} AS day, r.name AS recipe, w.target_weight_g::float8 AS target_g, w.actual_weight_g::float8 AS actual_g,
                 w.variance_g::float8 AS variance_g, w.within_tolerance
          FROM batch_weight_records w JOIN recipes r ON r.id = w.recipe_id`,
    columns: [date("day"), text("recipe"), num("target_g"), num("actual_g"), num("variance_g"), yes("within_tolerance")],
  },
  {
    name: "cook_chill",
    about: "Cook and chill records for sub-recipes.",
    pageKey: "/reports",
    minRole: "manager",
    sql: `SELECT ${londonDay("c.cooked_at")} AS day, c.sub_recipe_name AS sub_recipe, c.cook_temp_c::float8 AS cook_temp_c, c.cook_held_for_seconds::float8 AS held_for_seconds,
                 ${minutesBetween("c.chill_start_at", "c.chill_end_at")} AS chill_minutes, c.chilled_via
          FROM cook_chill_records c`,
    columns: [date("day"), text("sub_recipe"), num("cook_temp_c"), num("held_for_seconds"), num("chill_minutes"), text("chilled_via")],
  },
  {
    name: "visitors",
    about: "Visits to site by company and purpose. No names or health answers.",
    pageKey: "/reports",
    minRole: "manager",
    sql: `SELECT ${londonDay("v.signed_in_at")} AS day, v.company, v.purpose, ${londonTime("v.signed_in_at")} AS signed_in, ${londonTime("v.signed_out_at")} AS signed_out, v.entry_permitted
          FROM visitor_log v`,
    columns: [date("day"), text("company"), text("purpose"), text("signed_in"), text("signed_out"), yes("entry_permitted")],
  },
  {
    name: "team_efficiency",
    about: "The daily Team efficiency figure: percentage, packs and orders despatched. No money or labour figures.",
    pageKey: "/analytics/efficiency",
    minRole: "manager",
    sql: `SELECT e.date AS day, e.status, e.efficiency_pct::float8 AS efficiency_pct, e.packs_despatched::float8 AS packs_despatched,
                 e.orders_despatched::float8 AS orders_despatched, e.eight_pack_bags::float8 AS eight_pack_bags
          FROM team_efficiency_days e`,
    columns: [date("day"), text("status"), num("efficiency_pct"), num("packs_despatched"), num("orders_despatched"), num("eight_pack_bags")],
  },
];

export const datasetByName = (name: unknown): JaneDataset | undefined => JANE_DATASETS.find((d) => d.name === name);
