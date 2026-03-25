-- ============================================================
-- TCK Production Seed
-- Generated: 2026-03-25T14:36:43.893Z
--
-- !! WARNING: For a FRESHLY-PROVISIONED production database only !!
-- TRUNCATE … CASCADE also clears dependent tables:
-- production_plan_items, prep_completions, batch_completions,
-- daily_stock_checks, temperature_records, oven_events, etc.
-- Do NOT run against a database with live operational data.
--
-- Apply via psql:
--   psql "$PRODUCTION_DATABASE_URL" < prod-seed.sql
--
-- Or POST to /api/admin/apply-seed (see MIGRATION.md).
-- ============================================================

-- ── Step 1: clear seed tables (CASCADE wipes dependent tables) ──
TRUNCATE TABLE
  ingredient_storage_locations,
  kanban_items,
  delivery_check_configs,
  dpt_settings,
  sub_recipe_sub_recipes,
  sub_recipe_ingredients,
  recipe_shopify_mappings,
  recipe_meat_marinades,
  recipe_sub_recipes,
  recipe_ingredients,
  stock_items,
  storage_racks,
  recipes,
  sub_recipes,
  ingredients,
  sku_locations,
  postcode_validations,
  page_permissions,
  app_settings,
  timing_standards,
  category_defaults,
  stock_item_categories,
  storage_locations,
  suppliers
CASCADE;

-- ── Step 2: insert seed data (FK-safe order) ──────────────────

-- TABLE: suppliers (18 rows)
INSERT INTO suppliers (id, name, contact_name, email, phone, website, address, notes, created_at, order_frequency, order_days, lead_time_days, cutoff_time) VALUES
  (1, 'Brakes Food Service', 'Katherine Tierney', 'Katherine.Tierney@sysco.com', '01827 303770', 'https://www.brake.co.uk/en-GB', NULL, NULL, '2026-03-18 06:02:49.051', 'daily', NULL, 1, '17:00'),
  (2, 'Express Food Service', NULL, NULL, NULL, 'https://www.express-foodservice.co.uk/', NULL, NULL, '2026-03-19 09:12:57.620', 'daily', NULL, 1, '17:00'),
  (3, 'The Best Butcher', 'Simon Boddy', 'bestbutchers@gmail.com', ' 01908 375 275', 'https://www.thebestbutchers.co.uk/', NULL, NULL, '2026-03-19 09:13:52.553', 'daily', NULL, 1, '17:00'),
  (5, 'AB Fruits', NULL, NULL, NULL, 'https://app.fresho.com/customer_ordering/companies/77747b4c-4862-4ae6-9ff9-3c26d7bb45b3/marketplaces', NULL, NULL, '2026-03-19 09:57:55.892', 'daily', NULL, 1, '16:00'),
  (8, 'Basco Fine Foods', NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-19 09:57:55.948', 'daily', NULL, 1, '17:00'),
  (9, 'Waterdene', NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-19 09:57:55.959', 'daily', NULL, 1, '17:00'),
  (10, 'A D Maria', NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-19 09:57:55.966', 'weekly', 'Tuesday', 2, '17:00'),
  (12, 'Butcher Sundries', NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-19 09:57:55.984', 'daily', NULL, 1, '17:00'),
  (16, 'The Sauce Shop', NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-19 09:57:56.083', 'daily', NULL, 1, '17:00'),
  (17, 'TCK', NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-19 09:57:56.149', 'daily', NULL, 1, '17:00'),
  (18, 'Dalziel', NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-19 09:57:56.165', 'daily', NULL, 1, '17:00'),
  (19, 'Universal Products', NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-19 09:57:56.191', 'daily', NULL, 1, '17:00'),
  (20, 'Starry Mart', NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-19 09:57:56.206', 'daily', NULL, 1, '17:00'),
  (22, 'Amazon', NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-19 09:57:56.262', 'daily', NULL, 1, '17:00'),
  (23, 'Bidfood', NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-19 09:57:56.337', 'daily', NULL, 1, '17:00'),
  (24, 'Jay D Meats', NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-19 09:57:56.475', 'daily', NULL, 1, '17:00'),
  (25, 'Test Lead Time Supplier', NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-24 14:30:57.710', 'daily', NULL, 3, '10:00'),
  (26, 'NFS Meats', 'Vera', 'sales@nfsmeats.co.uk', '01604 761746', 'https://nfsmeats.co.uk/', NULL, NULL, '2026-03-24 15:57:12.642', 'daily', NULL, 2, '17:00');


-- TABLE: storage_locations (6 rows)
INSERT INTO storage_locations (id, name, zone, is_system, created_at) VALUES
  (1, 'Prep Fridge', 'fridge', TRUE, '2026-03-24 09:35:49.936'),
  (2, 'Raw Meat Fridge', 'fridge', TRUE, '2026-03-24 09:35:49.939'),
  (3, 'Raw Freezer', 'freezer', TRUE, '2026-03-24 09:35:49.941'),
  (4, 'Production Fridge', 'fridge', TRUE, '2026-03-24 09:35:49.945'),
  (5, 'Production Freezer', 'freezer', TRUE, '2026-03-24 09:35:49.947'),
  (6, 'Dry Store', 'ambient', TRUE, '2026-03-24 09:35:49.950');


-- TABLE: stock_item_categories (3 rows)
INSERT INTO stock_item_categories (id, name, created_at) VALUES
  (3, 'Chemicals', '2026-03-24 09:57:13.402'),
  (2, 'Cleaning Materials', '2026-03-24 09:57:13.402'),
  (1, 'Packaging', '2026-03-24 09:57:13.402');


-- TABLE: category_defaults (1 rows)
INSERT INTO category_defaults (id, category, default_packaging_cost, default_labour_cost, created_at) VALUES
  (1, 'Calzones', '0.4000', '3.0000', '2026-03-19 14:43:37.682');


-- TABLE: timing_standards (11 rows)
INSERT INTO timing_standards (id, station_type, station_label, min_batches_per_hour, target_batches_per_hour, updated_at) VALUES
  (1, 'building_1', 'Building 1', '9.00', '10.00', '2026-03-20 12:53:18.437'),
  (2, 'building_2', 'Building 2', '9.00', '10.00', '2026-03-20 12:53:11.527'),
  (3, 'mixing', 'Mixing & Cooking', '0.00', '0.00', '2026-03-19 17:48:17.925'),
  (4, 'ovens', 'Ovens', '0.00', '0.00', '2026-03-19 17:48:22.008'),
  (5, 'wrapping', 'Wrapping', '0.00', '0.00', '2026-03-19 17:48:26.098'),
  (6, 'packing', 'Packing', '0.00', '0.00', '2026-03-19 17:48:30.024'),
  (7, 'dough_prep', 'Dough Prep', '0.00', '0.00', '2026-03-19 17:48:34.322'),
  (8, 'dough_sheeting', 'Dough Sheeting', '0.00', '0.00', '2026-03-19 17:48:38.420'),
  (9, 'prep_veg', 'Prep - Raw Veg', '0.00', '0.00', '2026-03-19 17:48:42.304'),
  (10, 'prep_bases', 'Prep - Bases & Mozzarella', '0.00', '0.00', '2026-03-19 17:48:46.595'),
  (11, 'prep_meat', 'Prep - Raw Meat', '0.00', '0.00', '2026-03-19 17:48:50.655');


-- TABLE: app_settings (14 rows)
INSERT INTO app_settings (id, key, value, updated_at) VALUES
  (13, 'apc_service_code_large_friday', 'WD16', '2026-03-23 11:46:18.537'),
  (12, 'apc_service_code_large_weekday', 'ND16', '2026-03-23 11:46:18.527'),
  (14, 'apc_service_code_small_friday', 'WL16', '2026-03-23 11:46:18.524'),
  (11, 'apc_service_code_small_weekday', 'LW16', '2026-03-23 11:46:18.536'),
  (26, 'apc_test_mode', 'true', '2026-03-23 11:46:08.590'),
  (15, 'apc_weight_threshold_grams', '7001', '2026-03-23 11:46:18.521'),
  (73, 'daily_extra_pack_ball_count', '2', '2026-03-24 06:34:41.516'),
  (74, 'daily_extra_pack_ball_weight_g', '230', '2026-03-24 06:34:41.516'),
  (72, 'daily_snack_ball_count', '1', '2026-03-24 06:34:41.514'),
  (75, 'daily_snack_ball_weight_g', '200', '2026-03-24 06:34:41.518'),
  (8, 'default_break_minutes', '20', '2026-03-21 06:50:29.093'),
  (1, 'mixer_capacity_kg', '25', '2026-03-20 05:43:38.020'),
  (92, 'production_order_recipe_ids', '[1,10,6,4,2,5,3,9,7,8]', '2026-03-24 12:52:44.101'),
  (3, 'total_daily_batches', '75', '2026-03-22 17:22:00.839');


-- TABLE: page_permissions (9 rows)
INSERT INTO page_permissions (page_key, min_role) VALUES
  ('/', 'viewer'),
  ('/dispatches', 'viewer'),
  ('/ingredients', 'viewer'),
  ('/plans', 'viewer'),
  ('/recipes', 'viewer'),
  ('/sales', 'manager'),
  ('/stock', 'viewer'),
  ('/sub-recipes', 'viewer'),
  ('/suppliers', 'viewer');


-- TABLE: postcode_validations (0 rows)
-- postcode_validations: no rows


-- TABLE: sku_locations (0 rows)
-- sku_locations: no rows


-- TABLE: ingredients (201 rows)
INSERT INTO ingredients (id, name, unit, cost_per_pack, notes, created_at, pack_weight, brand, supplier_part_number, supplier_id, secondary_supplier_id, ordering_url, processing_ratio, raw_meat_tray_capacity_kg, category, stock_check_enabled, stock_check_frequency, stock_check_day, min_cooking_temp_c, estimated_cook_time_min, oven_temp_c, steam_pct, surplus_percent, shelf_life_days, kanban_enabled, kanban_quantity, kanban_unit, kanban_order_amount, perishable, pallet_size) VALUES
  (3, 'Salt', 'kg', '7.8500', 'Dough', '2026-03-17 17:27:12.929', '6.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (7, 'Fior Di Latte', 'kg', '49.9900', 'Cheese', '2026-03-18 09:14:31.112', '10.0000', NULL, NULL, 2, NULL, 'www.adimaria.co.uk', '1.0000', NULL, 'base', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '550.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (11, 'Pepperoni', 'kg', '10.2800', 'Meat', '2026-03-19 09:57:55.886', '1.0000', NULL, 'C 135639', 1, NULL, NULL, '1.0000', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (12, 'Red peppers', 'kg', '13.9500', 'Vegetables', '2026-03-19 09:57:55.900', '5.0000', NULL, NULL, 5, 1, NULL, '0.8470', NULL, 'vegetable', TRUE, 'daily', NULL, NULL, NULL, NULL, NULL, '215.00', 5, FALSE, '0.0000', 'weight', NULL, TRUE, NULL),
  (13, 'Red Onions', 'kg', '3.0500', 'Vegetables', '2026-03-19 09:57:55.902', '1.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', TRUE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, FALSE, '0.0000', 'weight', NULL, TRUE, NULL),
  (14, 'Mushrooms', 'kg', '8.2000', 'Vegetables', '2026-03-19 09:57:55.906', '2.5000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '100.00', 5, FALSE, '0.0000', 'weight', NULL, TRUE, NULL),
  (15, 'Spring Onions', 'kg', '5.8000', 'Vegetables', '2026-03-19 09:57:55.908', '1.0000', NULL, NULL, 5, NULL, NULL, '0.8700', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '100.00', 5, FALSE, '0.0000', 'weight', NULL, TRUE, NULL),
  (16, 'Courgettes', 'kg', '10.9500', 'Vegetables', '2026-03-19 09:57:55.912', '5.0000', NULL, NULL, 5, NULL, NULL, '0.9569', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '215.00', 5, FALSE, '0.0000', 'weight', NULL, TRUE, NULL),
  (17, 'Tomatoes', 'kg', '10.9500', 'Vegetables', '2026-03-19 09:57:55.916', '6.0000', NULL, NULL, 5, NULL, NULL, '0.8744', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (18, 'Basil', 'g', '1.7900', 'Herbs and Spices', '2026-03-19 09:57:55.919', '100.0000', NULL, NULL, 5, NULL, NULL, '0.6016', NULL, 'vegetable', TRUE, 'daily', NULL, NULL, NULL, NULL, NULL, '125.00', NULL, FALSE, '0.0000', 'weight', NULL, TRUE, NULL),
  (19, 'Rosemary', 'g', '1.7900', 'Herbs and Spices', '2026-03-19 09:57:55.921', '100.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'herb', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '250.00', NULL, FALSE, '0.0000', 'weight', NULL, TRUE, NULL),
  (20, 'Goats Cheese', 'kg', '13.9500', 'Cheese', '2026-03-19 09:57:55.935', '1.0000', NULL, NULL, NULL, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (21, 'Chicken', 'kg', '5.3900', 'Meat | 01908 375275', '2026-03-19 09:57:55.941', '1.0000', NULL, NULL, 26, 3, 'sales@nfsmeats.co.uk', '0.7717', '4.0000', 'raw_meat', TRUE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, FALSE, '0.0000', 'weight', NULL, TRUE, NULL),
  (22, 'Pork', 'kg', '5.8500', 'Meat', '2026-03-19 09:57:55.944', '1.0000', NULL, NULL, 3, NULL, NULL, '0.7300', '6.0000', 'raw_meat', TRUE, 'daily', NULL, '75.00', 180, 155, 70, '30.00', NULL, FALSE, '0.0000', 'weight', NULL, TRUE, NULL),
  (23, 'Chorizo', 'g', '5.5500', 'Meat', '2026-03-19 09:57:55.952', '500.0000', NULL, 'C 149839', 1, 8, 'https://tapaslunchwholesale.co.uk/', '1.0000', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (24, 'Duck', 'kg', '11.9900', 'Meat | 01837 811333', '2026-03-19 09:57:55.956', '1.0000', NULL, NULL, 2, NULL, NULL, '1.0000', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (25, 'Olive Oil', 'kg', '39.9900', 'Dough', '2026-03-19 09:57:55.962', '5.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (26, 'Passata (Rodolfi)', 'kg', '16.5000', 'Base', '2026-03-19 09:57:55.969', '10.0000', NULL, NULL, 10, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '700.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (27, 'Demerrera Sugar', 'kg', '7.8500', 'Herbs and Spices', '2026-03-19 09:57:55.971', '3.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (28, 'Balsamic Glaze', 'g', '2.6200', 'Sauces', '2026-03-19 09:57:55.973', '500.0000', NULL, NULL, 10, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (29, 'Artichoke (drained weight)', 'g', '3.0000', 'Vegetables', '2026-03-19 09:57:55.978', '540.0000', NULL, NULL, NULL, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (30, 'Jalapenos (Drained weight)', 'kg', '5.6900', 'Vegetables', '2026-03-19 09:57:55.981', '3.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (31, 'Piri Piri Glaze (MRC)', 'kg', '18.3900', 'Herbs and Spices', '2026-03-19 09:57:55.989', '2.5000', NULL, NULL, 12, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (32, 'Flour (00)', 'kg', '16.6900', 'Dough', '2026-03-19 09:57:55.994', '15.0000', 'Caputo Blue', NULL, 2, NULL, 'www.adimaria.co.uk', '1.0000', NULL, 'dough', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (33, 'Yeast', 'g', '4.2500', 'Dough', '2026-03-19 09:57:55.998', '500.0000', NULL, NULL, 10, NULL, NULL, '1.0000', NULL, 'dough', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '1500.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (34, 'Feta', 'g', '13.4900', 'Cheese', '2026-03-19 09:57:56.001', '900.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (35, 'Chives', 'g', '0.7000', 'Herbs and Spices', '2026-03-19 09:57:56.004', '30.0000', NULL, NULL, NULL, NULL, NULL, '1.0000', NULL, 'herb', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (36, 'Sliced Black Olives', 'g', '0.7500', 'Vegetables', '2026-03-19 09:57:56.008', '170.0000', NULL, NULL, NULL, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (37, 'Tomato Puree (paste)', 'g', '2.4300', 'Base | 01525 371367', '2026-03-19 09:57:56.012', '800.0000', NULL, NULL, 10, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '700.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (38, 'Garlic Granules', 'g', '6.1200', 'Herbs and Spices', '2026-03-19 09:57:56.016', '700.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (39, 'Ground black pepper', 'g', '6.1200', 'Herbs and Spices', '2026-03-19 09:57:56.019', '500.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (40, 'Course Black Pepper', 'g', '6.2600', 'Herbs and Spices', '2026-03-19 09:57:56.022', '500.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (41, 'Paprika', 'g', '4.1500', 'Herbs and Spices', '2026-03-19 09:57:56.026', '550.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (42, 'Chilli powder', 'g', '4.4500', 'Herbs and Spices', '2026-03-19 09:57:56.029', '400.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (43, 'Oregano', 'g', '3.0600', 'Herbs and Spices', '2026-03-19 09:57:56.032', '150.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'herb', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (44, 'Mixed Herbs', 'g', '3.0200', 'Herbs and Spices', '2026-03-19 09:57:56.034', '150.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'herb', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (45, 'BBQ Sauce (lion sticky)', 'kg', '7.3900', 'Sauces', '2026-03-19 09:57:56.036', '2.2000', NULL, NULL, 9, 1, NULL, '1.0000', NULL, 'sauce', FALSE, 'weekly', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '12.0000', 'pack', '13.0000', TRUE, NULL),
  (46, 'Mayonnaise', 'kg', '24.1300', 'Sauces', '2026-03-19 09:57:56.039', '10.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (47, 'Mozzarella', 'kg', '47.9900', 'Cheese', '2026-03-19 09:57:56.042', '12.0000', NULL, NULL, 2, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '470.00', NULL, FALSE, '0.0000', 'weight', NULL, TRUE, NULL),
  (48, 'Crushed chillis', 'g', '5.2600', 'Herbs and Spices', '2026-03-19 09:57:56.045', '300.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (49, 'Hoisin Sauce', 'kg', '7.7600', 'Sauces', '2026-03-19 09:57:56.049', '2.0000', NULL, NULL, NULL, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (50, 'White onions', 'kg', '16.5000', 'Vegetables', '2026-03-19 09:57:56.052', '20.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (51, 'Rib Meat', 'kg', '15.0000', 'Meat', '2026-03-19 09:57:56.058', '1.0000', NULL, NULL, NULL, NULL, NULL, '1.0000', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (52, 'Ghekins', 'kg', '3.8900', 'Vegetables', '2026-03-19 09:57:56.063', '1.3500', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (53, 'Pomodori Peeled Plum Tomatoes', 'kg', '2.6400', 'Vegetables', '2026-03-19 09:57:56.067', '2.5000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (54, 'Minced Garlic', 'kg', '5.1900', 'Herbs and Spices', '2026-03-19 09:57:56.070', '1.3600', NULL, NULL, NULL, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (55, 'Lemon Juice (Quick lemon)', 'kg', '2.4400', 'Sauces', '2026-03-19 09:57:56.073', '1.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (56, 'Burger Meat', 'kg', '9.9000', 'Meat', '2026-03-19 09:57:56.076', '1.0000', NULL, NULL, 3, NULL, NULL, '0.7000', '2.9000', 'raw_meat', TRUE, 'daily', NULL, '70.00', 30, 150, 70, '250.00', NULL, FALSE, '0.0000', 'weight', NULL, TRUE, NULL),
  (57, 'Gherkin (drained weight)', 'kg', '7.0400', 'Vegetables', '2026-03-19 09:57:56.078', '1.3800', NULL, NULL, 9, 1, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (58, 'Red Onion Chutney', 'kg', '9.4800', 'Sauces', '2026-03-19 09:57:56.081', '1.2500', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '12.0000', 'pack', '13.0000', TRUE, NULL),
  (59, 'Burger Sauce', 'kg', '15.0000', 'Sauces', '2026-03-19 09:57:56.086', '2.1000', NULL, NULL, 16, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (60, 'Garlic Puree', 'kg', '4.2300', 'Herbs and Spices', '2026-03-19 09:57:56.091', '1.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (61, 'Grated matture Cheddar', 'kg', '5.4300', 'Cheese', '2026-03-19 09:57:56.095', '1.0000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '200.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (62, 'Dried Thyme', 'g', '3.0900', 'Herbs and Spices', '2026-03-19 09:57:56.099', '180.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'herb', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (63, 'Garlic Cloves fresh peeled', 'kg', '5.4100', 'Herbs and Spices', '2026-03-19 09:57:56.102', '1.0000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (64, 'Frozen dough balls', 'kg', '42.9900', 'Dough balls', '2026-03-19 09:57:56.105', '5.5850', NULL, NULL, 2, NULL, NULL, '1.0000', NULL, 'dough', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (65, 'Salted Butter', 'kg', '68.5000', 'Dairy', '2026-03-19 09:57:56.109', '10.0000', NULL, NULL, 5, 9, NULL, '1.0000', NULL, 'dairy', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (66, 'Dried Parsley', 'g', '2.7400', 'Herbs and Spices', '2026-03-19 09:57:56.112', '120.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'herb', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (67, 'Meahs Tikka Sauce', 'kg', '18.9900', 'Sauces', '2026-03-19 09:57:56.115', '3.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (68, 'Green Peppers', 'kg', '13.9500', 'Vegetables', '2026-03-19 09:57:56.117', '5.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (69, 'Greek Yoghurt', 'kg', '7.2500', 'Dairy', '2026-03-19 09:57:56.119', '1.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'dairy', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (70, 'Special Sausage', 'kg', '6.5000', 'Meat', '2026-03-19 09:57:56.121', '1.0000', NULL, NULL, NULL, NULL, NULL, '0.8700', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (71, 'Pancetta', 'kg', '11.5000', NULL, '2026-03-19 09:57:56.124', '1.0000', NULL, NULL, NULL, NULL, NULL, '0.6600', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (72, 'Red Chillis', 'kg', '33.6500', 'Vegetables', '2026-03-19 09:57:56.127', '3.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '200.00', 5, FALSE, '0.0000', 'weight', NULL, TRUE, NULL),
  (73, 'Ground Cumin', 'g', '4.6200', 'Herbs and Spices', '2026-03-19 09:57:56.130', '400.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (74, 'Ground Nutmeg', 'g', '13.5600', 'Herbs and Spices', '2026-03-19 09:57:56.133', '500.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (75, 'Dried Basil', 'g', '2.9200', 'Herbs and Spices', '2026-03-19 09:57:56.136', '150.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'herb', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (76, 'Beef Bouillion', 'kg', '19.9600', 'Herbs and Spices', '2026-03-19 09:57:56.139', '1.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (77, 'Matture Cheddar', 'kg', '14.9500', 'Dairy', '2026-03-19 09:57:56.142', '2.0000', NULL, NULL, 5, 9, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, FALSE, '0.0000', 'weight', NULL, TRUE, NULL),
  (78, 'Braising Beef', 'kg', '9.9000', 'Meat', '2026-03-19 09:57:56.145', '1.0000', NULL, NULL, 1, NULL, NULL, '1.0000', '3.5000', 'raw_meat', TRUE, 'daily', NULL, '70.00', 240, 155, 70, '10.00', NULL, FALSE, '0.0000', 'weight', NULL, TRUE, NULL),
  (79, 'Calzone Dough', 'kg', '0.8500', NULL, '2026-03-19 09:57:56.152', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'dough', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (81, 'Spicy Base', 'kg', '2.8300', NULL, '2026-03-19 09:57:56.158', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (82, 'Buttermilk Fried Chicken Strip', 'kg', '0.6900', NULL, '2026-03-19 09:57:56.160', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (83, 'Whole Milk', 'kg', '2.7900', 'Dairy', '2026-03-19 09:57:56.162', '2.2700', NULL, 'C 70219', 1, NULL, NULL, '1.0000', NULL, 'dairy', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '0.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (84, 'Spicy Breading', 'kg', '56.1400', NULL, '2026-03-19 09:57:56.167', '7.0000', NULL, NULL, 18, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (85, 'Panko Breadcrumbs', 'kg', '4.5400', NULL, '2026-03-19 09:57:56.170', '1.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (86, 'Garlic Powder', 'g', '4.7000', NULL, '2026-03-19 09:57:56.173', '500.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (87, 'Onion Powder', 'kg', '14.8900', NULL, '2026-03-19 09:57:56.175', '2.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (88, 'Ground Ginger', 'g', '4.9100', NULL, '2026-03-19 09:57:56.178', '450.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (89, 'Madras Curry Powder', 'g', '3.4700', NULL, '2026-03-19 09:57:56.181', '450.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (90, 'Turmeric', 'g', '4.5800', NULL, '2026-03-19 09:57:56.185', '500.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (91, 'Katsu Spice Mix', 'g', '0.0000', NULL, '2026-03-19 09:57:56.188', '770.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (92, 'Hoisin Sauce (Blue Dragon)', 'kg', '6.4600', NULL, '2026-03-19 09:57:56.194', '1.2500', 'Blue Dragon', NULL, 19, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (93, 'Carrots (Grated)', 'kg', '2.7500', NULL, '2026-03-19 09:57:56.198', '1.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (94, 'Chicken Boullion', 'kg', '15.9100', NULL, '2026-03-19 09:57:56.200', '1.0200', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (95, 'Tap Water', 'kg', '0.0000', NULL, '2026-03-19 09:57:56.203', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (96, 'Dark Soy Sauce', 'kg', '6.9900', NULL, '2026-03-19 09:57:56.209', '1.7500', 'Lee Kum Kee', NULL, 20, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (97, 'Honey (CR)', 'g', '3.3900', NULL, '2026-03-19 09:57:56.212', '680.0000', 'Country Range', NULL, 9, NULL, NULL, '0.9500', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (98, 'Plain Flour', 'kg', '11.4900', NULL, '2026-03-19 09:57:56.214', '16.0000', 'Country Range', NULL, 9, NULL, NULL, '1.0000', NULL, 'dough', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '760.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (99, 'Carrots (Diced)', 'kg', '2.7500', NULL, '2026-03-19 09:57:56.217', '1.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (100, 'Baby Back Pork Ribs', 'kg', '72.0000', NULL, '2026-03-19 09:57:56.219', '10.0000', NULL, NULL, NULL, NULL, NULL, '1.0000', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (101, 'Yangnyeom Korean Sauce', 'kg', '4.3700', NULL, '2026-03-19 09:57:56.223', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (102, 'Basil puree', 'kg', '14.7300', NULL, '2026-03-19 09:57:56.226', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (103, 'Nacho Cheese Sauce', 'kg', '20.6300', NULL, '2026-03-19 09:57:56.229', '1.5640', NULL, NULL, 18, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (104, 'Philly Beef Mix', 'kg', '13.9800', NULL, '2026-03-19 09:57:56.232', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (105, 'Ham (sliced gammon)', 'g', '4.4900', NULL, '2026-03-19 09:57:56.235', '530.0000', NULL, NULL, 2, NULL, NULL, '1.0000', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (106, 'Branston Pickle', 'kg', '14.5500', NULL, '2026-03-19 09:57:56.237', '2.5500', NULL, NULL, 9, NULL, NULL, '0.9700', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (107, 'Chargrilled peppers', 'kg', '12.7000', NULL, '2026-03-19 09:57:56.240', '1.9000', NULL, NULL, 10, NULL, NULL, '0.5900', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (108, 'Chargrilled Aubergines', 'kg', '12.7000', NULL, '2026-03-19 09:57:56.242', '1.9000', NULL, NULL, 10, NULL, NULL, '0.5300', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (109, 'Chargrilled Artichokes', 'kg', '10.9800', NULL, '2026-03-19 09:57:56.245', '1.0000', NULL, NULL, 5, NULL, NULL, '0.9500', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (110, 'Corn flour', 'kg', '13.7200', NULL, '2026-03-19 09:57:56.250', '5.0000', NULL, NULL, NULL, NULL, 'https://www.buywholefoodsonline.co.uk/cornflour-corn-starch.html', '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (111, 'Corn Starch', 'kg', '13.7200', NULL, '2026-03-19 09:57:56.253', '5.0000', NULL, NULL, NULL, NULL, 'https://www.buywholefoodsonline.co.uk/cornflour-corn-starch.html', '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (112, 'Potato Starch', 'kg', '11.6900', NULL, '2026-03-19 09:57:56.255', '2.0000', NULL, NULL, NULL, NULL, 'https://www.buywholefoodsonline.co.uk/organic-potato-starch.html', '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (113, 'Skimmed Milk Powder', 'kg', '11.5500', NULL, '2026-03-19 09:57:56.259', '2.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'dairy', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (114, 'Egg White Powder', 'kg', '29.9500', NULL, '2026-03-19 09:57:56.264', '1.0000', NULL, NULL, 22, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (115, 'Icing Sugar', 'kg', '7.2300', NULL, '2026-03-19 09:57:56.267', '3.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (116, 'Marinade Spice Mix', 'kg', '11.2800', NULL, '2026-03-19 09:57:56.270', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (117, 'Red Cooking Wine', 'kg', '6.9500', NULL, '2026-03-19 09:57:56.272', '5.0000', NULL, NULL, 10, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (118, 'White Cooking Wine', 'kg', '6.9500', NULL, '2026-03-19 09:57:56.275', '5.0000', NULL, NULL, 10, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (119, 'Fresh Thyme', 'g', '1.7900', NULL, '2026-03-19 09:57:56.278', '100.0000', NULL, NULL, 5, NULL, NULL, '0.6500', NULL, 'herb', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (120, 'Beef Gravy Granules', 'kg', '15.5500', NULL, '2026-03-19 09:57:56.281', '1.8000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (121, 'Beef Welly Mix', 'kg', '10.1300', NULL, '2026-03-19 09:57:56.284', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (122, 'Chestnut Mushrooms', 'kg', '10.9500', NULL, '2026-03-19 09:57:56.287', '2.2700', NULL, NULL, 5, NULL, NULL, '0.9500', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (123, 'Mushroom Duxelle', 'kg', '11.4700', NULL, '2026-03-19 09:57:56.289', '1.3250', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (124, 'Spicy Chicken', 'kg', '10.0000', NULL, '2026-03-19 09:57:56.292', '1.0000', NULL, NULL, NULL, NULL, NULL, '0.8000', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (125, 'Streaky Bacon', 'kg', '12.0000', NULL, '2026-03-19 09:57:56.294', '1.0000', NULL, NULL, NULL, NULL, NULL, '0.5200', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (126, 'Red Onion Gravy', 'kg', '2.0900', NULL, '2026-03-19 09:57:56.297', '1.0000', NULL, NULL, 17, NULL, NULL, '0.9400', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (127, 'Cranberry', 'kg', '8.9000', NULL, '2026-03-19 09:57:56.300', '2.5000', 'Country Range', NULL, 9, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (128, 'Smoked paprika', 'g', '7.2500', NULL, '2026-03-19 09:57:56.305', '750.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (129, 'Peeled Shallots', 'kg', '9.2000', NULL, '2026-03-19 09:57:56.308', '1.0000', NULL, NULL, 5, NULL, NULL, '0.9500', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (130, 'Red Wine', 'g', '5.3700', NULL, '2026-03-19 09:57:56.311', '750.0000', NULL, NULL, 10, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (131, 'Dried Cranberries', 'kg', '10.8900', NULL, '2026-03-19 09:57:56.313', '1.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'herb', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (132, 'Riccota', 'kg', '10.1300', NULL, '2026-03-19 09:57:56.316', '1.5000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (133, 'Baby Spinach', 'kg', '12.4900', NULL, '2026-03-19 09:57:56.318', '2.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (134, 'TCK Roasted Red peppers', 'kg', '13.9500', NULL, '2026-03-19 09:57:56.321', '1.0000', NULL, NULL, 17, NULL, NULL, '0.5100', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (135, 'TCK Roasted Mushroons', 'kg', '10.9500', NULL, '2026-03-19 09:57:56.325', '2.5000', NULL, NULL, 17, NULL, NULL, '0.6000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (136, 'Cauliflower', 'kg', '29.5000', NULL, '2026-03-19 09:57:56.328', '5.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (137, 'Cinnamon', 'g', '7.5700', NULL, '2026-03-19 09:57:56.330', '450.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (138, 'Roasted Red Peppers', 'kg', '12.2900', NULL, '2026-03-19 09:57:56.333', '2.2000', NULL, NULL, 5, NULL, NULL, '0.9500', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (139, 'American Mustard', 'kg', '27.9600', NULL, '2026-03-19 09:57:56.339', '11.6000', 'French''s', NULL, 1, NULL, 'https://www.brake.co.uk/dry-store/condiments-pickles/bulk-condiments/mustard/french-s-classic-yellow-mustard-3ltr/p/125178?term=yellow mustard', '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '2.0000', 'weight', NULL, TRUE, NULL),
  (140, 'Vegetable Oil', 'kg', '25.9900', NULL, '2026-03-19 09:57:56.342', '20.0000', 'KTC', NULL, 2, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (141, 'Broccoli (prepared)', 'kg', '17.5000', NULL, '2026-03-19 09:57:56.344', '2.5000', NULL, NULL, 5, NULL, NULL, '0.7400', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (142, 'Taleggio', 'kg', '9.6900', NULL, '2026-03-19 09:57:56.346', '1.0000', NULL, NULL, 10, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (143, 'Bechemel', 'kg', '6.0700', NULL, '2026-03-19 09:57:56.349', '1.0000', NULL, NULL, 9, NULL, NULL, '0.9800', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (144, 'Dijon Mustard', 'kg', '13.0100', NULL, '2026-03-19 09:57:56.352', '2.2700', 'Lion', NULL, 1, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (145, 'Gorgonzola Dolce', 'kg', '15.1200', NULL, '2026-03-19 09:57:56.354', '1.6000', NULL, NULL, 10, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (146, 'Cider Vinegar', 'kg', '8.5300', NULL, '2026-03-19 09:57:56.356', '5.0000', NULL, NULL, 23, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (147, 'Tamari Soy Sauce (UPF Free)', 'kg', '24.9900', NULL, '2026-03-19 09:57:56.359', '6.0000', NULL, NULL, 23, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (148, 'Balsamic Vinegar', 'kg', '14.7500', NULL, '2026-03-19 09:57:56.362', '5.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (149, 'Hoisin Sauce (Knorr)', 'kg', '22.5800', NULL, '2026-03-19 09:57:56.364', '2.2000', 'Knorrs', NULL, 23, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (150, 'Hoisin Sauce (Bidfood Everyday)', 'kg', '25.2100', NULL, '2026-03-19 09:57:56.366', '7.8000', 'Bidfood Everyday', NULL, 23, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (151, 'Diced Chicken Thigh', 'kg', '19.6500', NULL, '2026-03-19 09:57:56.369', '2.5000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (152, 'Tikka Paste', 'kg', '10.9400', NULL, '2026-03-19 09:57:56.371', '1.1000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (153, 'Smoked Bacon Lardons', 'kg', '55.4300', NULL, '2026-03-19 09:57:56.373', '10.0000', NULL, NULL, 1, NULL, NULL, '0.5500', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (154, 'Diced Beef', 'kg', '25.8400', NULL, '2026-03-19 09:57:56.376', '2.5000', NULL, 'C 136642', 1, NULL, NULL, '1.0000', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (155, 'Szechuan Concentrated Sauce', 'kg', '12.1600', NULL, '2026-03-19 09:57:56.378', '1.0000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (156, 'Beef Strips', 'kg', '36.5700', NULL, '2026-03-19 09:57:56.380', '2.5000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (157, 'Rice Vinegar', 'kg', '12.3000', NULL, '2026-03-19 09:57:56.383', '3.0000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (158, 'Garlic Puree (Brakes)', 'kg', '10.2200', NULL, '2026-03-19 09:57:56.386', '1.2000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (159, 'Chilli Oil', 'kg', '18.0000', NULL, '2026-03-19 09:57:56.388', '1.0200', NULL, NULL, 22, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (160, 'Cream Cheese', 'kg', '17.6300', NULL, '2026-03-19 09:57:56.391', '2.0000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (161, 'Vanilla Extract', 'g', '5.5400', NULL, '2026-03-19 09:57:56.394', '500.0000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (162, 'Parmesan', 'kg', '23.1000', NULL, '2026-03-19 09:57:56.396', '1.0000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (163, 'Pineapple', 'kg', '15.4100', NULL, '2026-03-19 09:57:56.398', '2.5000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (164, 'Ham Hock', 'kg', '9.9900', NULL, '2026-03-19 09:57:56.400', '1.0000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (165, 'Bechemel (Macphie)', 'kg', '38.3500', NULL, '2026-03-19 09:57:56.403', '10.0000', NULL, 'A 9036', 1, NULL, NULL, '0.9800', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (166, 'Garlic Confit', 'kg', '22.7400', NULL, '2026-03-19 09:57:56.406', '2.7250', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (167, 'Jerk BBQ Sauce', 'kg', '8.9200', NULL, '2026-03-19 09:57:56.408', '1.0000', NULL, NULL, 1, NULL, NULL, '0.9700', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (168, 'Chipotle paste', 'g', '10.1400', NULL, '2026-03-19 09:57:56.411', '750.0000', 'Santa Maria', NULL, 1, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (169, 'Santa Maria BBQ Sauce', 'kg', '6.1100', NULL, '2026-03-19 09:57:56.413', '1.1000', 'Santa Maria', NULL, 1, NULL, NULL, '0.9700', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (170, 'Ranch', 'kg', '9.5700', NULL, '2026-03-19 09:57:56.415', '2.2700', 'Lion', NULL, 1, NULL, NULL, '0.9700', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (171, 'Mango Chutney', 'kg', '5.3900', NULL, '2026-03-19 09:57:56.418', '1.5000', 'Geetas', NULL, 1, NULL, NULL, '0.9700', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (172, 'Chickpeas', 'kg', '3.4500', NULL, '2026-03-19 09:57:56.420', '1.5000', 'Royal Crown', NULL, 1, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (173, 'Curry Powder', 'g', '7.9100', NULL, '2026-03-19 09:57:56.423', '500.0000', 'Sysco', NULL, 1, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (174, 'Tajin Classico Seasoning with Lime', 'g', '6.2300', NULL, '2026-03-19 09:57:56.425', '400.0000', 'Tajin', NULL, 22, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (175, 'Fresh Coriander', 'kg', '9.8400', NULL, '2026-03-19 09:57:56.427', '1.0000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'herb', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (176, 'Red Wine Vinegar', 'kg', '10.7200', NULL, '2026-03-19 09:57:56.429', '5.0000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (177, 'G''s Piri Piri Sauce', 'kg', '7.5200', NULL, '2026-03-19 09:57:56.432', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (178, 'Lime Juice', 'kg', '5.1000', NULL, '2026-03-19 09:57:56.435', '1.0000', 'Village Press', NULL, 1, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (179, 'Sirloin Steak', 'kg', '33.2800', NULL, '2026-03-19 09:57:56.437', '1.7000', NULL, 'C 136847', 1, NULL, NULL, '0.8000', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (180, 'Red cooking wine (Sysco)', 'kg', '37.9400', NULL, '2026-03-19 09:57:56.440', '10.0000', NULL, 'A 25690', 1, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (181, 'White Cooking Wine (Sysco)', 'kg', '36.7800', NULL, '2026-03-19 09:57:56.442', '10.0000', NULL, 'A 25696', 1, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (182, 'Prosciutto', 'kg', '16.9900', NULL, '2026-03-19 09:57:56.446', '1.0000', NULL, 'C 116165', 1, NULL, NULL, '1.0000', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (183, 'Red Wine Gravy (2025)', 'g', '0.7900', NULL, '2026-03-19 09:57:56.449', '87.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (184, 'Sirloin Steak Center Cut', 'kg', '18.2100', NULL, '2026-03-19 09:57:56.451', '1.1350', NULL, 'C 5010975', 1, NULL, NULL, '0.5550', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (185, 'Fillet steak (Sysco whole)', 'kg', '64.2400', NULL, '2026-03-19 09:57:56.453', '2.1000', NULL, 'C 133991', 1, NULL, NULL, '0.8000', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (186, 'BBQ Shredded Turkey & Cranberry', 'g', '4.1300', NULL, '2026-03-19 09:57:56.455', '500.0000', NULL, 'F 150200', 1, NULL, NULL, '1.0000', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (187, 'Turkey Saddle', 'kg', '31.0000', NULL, '2026-03-19 09:57:56.461', '3.5000', NULL, 'F 30311', 1, NULL, NULL, '1.0000', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (188, 'Pork, Sage & Onion Stuffing Balls', 'kg', '29.4100', NULL, '2026-03-19 09:57:56.464', '2.8800', NULL, 'F 124328', 1, NULL, NULL, '0.7900', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (189, 'Pigs In Blankets', 'kg', '15.5000', NULL, '2026-03-19 09:57:56.466', '1.0000', NULL, 'F 120676', 1, NULL, NULL, '0.7900', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '30.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (190, 'Cranberry Sauce', 'kg', '12.9500', NULL, '2026-03-19 09:57:56.468', '2.5000', NULL, 'A 100357', 1, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (191, 'Diced Chicken fillet', 'kg', '16.5900', NULL, '2026-03-19 09:57:56.471', '2.5000', NULL, 'C 70946', 1, NULL, NULL, '0.8700', '4.0000', 'raw_meat', TRUE, 'daily', NULL, '75.00', 30, 170, 70, '30.00', NULL, FALSE, '0.0000', 'weight', NULL, TRUE, NULL),
  (192, 'Beef Bouillon Paste', 'kg', '13.7400', NULL, '2026-03-19 09:57:56.473', '1.0000', NULL, 'A 100448', 1, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (193, 'Pastrami (Sliced)', 'kg', '20.9700', NULL, '2026-03-19 09:57:56.477', '1.0000', NULL, NULL, 24, NULL, NULL, '1.0000', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (194, 'Macaroni', 'kg', '4.6800', NULL, '2026-03-19 09:57:56.480', '3.0000', NULL, 'A 150173', 1, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (195, 'Red Leicester Cheese', 'kg', '24.9800', NULL, '2026-03-19 09:57:56.482', '2.5000', NULL, '9827', 9, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (196, 'Matture Cheddar Block', 'kg', '32.6800', NULL, '2026-03-19 09:57:56.485', '4.7500', NULL, 'C 71144', 1, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (197, 'Evaporated Milk', 'g', '1.1800', NULL, '2026-03-19 09:57:56.487', '410.0000', NULL, 'A25002', 1, NULL, NULL, '1.0000', NULL, 'dairy', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (198, 'Extra Matture Cheddar', 'kg', '22.1800', NULL, '2026-03-19 09:57:56.490', '2.4400', NULL, 'C74041', 1, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (199, 'Double Cream', 'kg', '8.9900', NULL, '2026-03-19 09:57:56.492', '2.2700', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'dairy', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '0.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (200, 'Beef Short Rib (Best Butchers)', 'kg', '12.5000', NULL, '2026-03-19 09:57:56.494', '1.0000', NULL, NULL, NULL, NULL, NULL, '0.5000', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (201, 'Knorr Korma Sauce', 'kg', '11.5400', NULL, '2026-03-19 09:57:56.497', '1.1000', NULL, 'A 85659', 1, NULL, NULL, '0.9800', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (202, 'Garlic Butter', 'g', '1.9600', NULL, '2026-03-19 09:57:56.499', '271.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (203, 'Honey Sriracha', 'kg', '40.0000', NULL, '2026-03-19 09:57:56.502', '5.0000', NULL, NULL, 16, NULL, 'https://wholesale.sauceshop.co/products/honey-sriracha-drizzle', '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (204, 'Minced Beef', 'kg', '13.9100', NULL, '2026-03-19 09:57:56.504', '2.5000', NULL, 'F 32680', 1, NULL, NULL, '0.8500', '2.5000', 'raw_meat', FALSE, 'daily', NULL, '70.00', 30, 170, 70, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (205, 'Chicken Seasoning Mix', 'kg', '21.3800', NULL, '2026-03-19 09:57:56.507', '3.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'seasoning', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (206, 'Cheeky Gluten Free Crispy Fried Onions', 'kg', '6.9100', NULL, '2026-03-23 17:09:49.528', '1.0000', 'Cheeky', '136733', 1, NULL, 'https://www.brake.co.uk/dry-store/cooking-ingredients/herbs-spices-seasonings/blends-other-seasonings/cheeky-gluten-free-crispy-fried-onions/p/136733', NULL, NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (207, 'Brakes Chilli Jam', 'kg', '9.8700', NULL, '2026-03-23 17:10:17.021', '1.2500', 'Brakes', '126918', 1, NULL, 'https://www.brake.co.uk/dry-store/condiments-pickles/chutney-relish-pickles/chutney-relish/brakes-chilli-jam/p/126918', NULL, NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (208, 'Streky Bacon', 'kg', '9.9900', NULL, '2026-03-23 17:11:02.220', '1.0000', NULL, 'NFS', NULL, NULL, NULL, NULL, NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (209, 'Sysco Classic Grated Monterey Jack Cheese', 'kg', '6.9900', NULL, '2026-03-23 17:21:22.760', '1.0000', 'Sysco Classic', '112826', 1, NULL, 'https://www.brake.co.uk/dairy/block-grated-cheese/soft-cheese/grated-shredded/sysco-classic-grated-monterey-jack-cheese/p/112826', NULL, NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL),
  (210, 'Beef Burgers', 'kg', '6.7900', NULL, '2026-03-23 17:26:33.316', '1.0000', 'NFS', NULL, NULL, NULL, NULL, NULL, '2.5000', 'raw_meat', TRUE, 'daily', NULL, '70.00', 30, 170, 50, '10.00', NULL, FALSE, '0.0000', 'weight', NULL, TRUE, NULL);


-- TABLE: stock_items (0 rows)
-- stock_items: no rows


-- TABLE: delivery_check_configs (0 rows)
-- delivery_check_configs: no rows


-- TABLE: sub_recipes (9 rows)
INSERT INTO sub_recipes (id, name, description, yield, yield_unit, notes, created_at, shelf_life_days, is_base) VALUES
  (1, 'Calzone Dough', '', '32.7600', 'kg', '20kg Flour Mix', '2026-03-17 17:30:37.829', 3, FALSE),
  (2, 'Tomato Base', 'TCK Signature Tomato Base', '11.8380', 'kg', 'Needs base mix adding as sub recipe', '2026-03-18 09:38:47.728', 0, TRUE),
  (41, 'Normal Base Dry Mix', 'Dry spice mix for TCK Signature normal base', '3.0270', 'kg', '', '2026-03-19 11:27:06.116', NULL, FALSE),
  (42, 'Pork Rub', '', '1.0000', 'kg', '', '2026-03-19 14:50:42.689', NULL, FALSE),
  (43, 'Garlic Butter', NULL, '0.2710', 'kg', NULL, '2026-03-19 15:58:57.192', NULL, FALSE),
  (44, 'Garlic Confit', NULL, '3.8090', 'kg', NULL, '2026-03-19 16:00:48.266', NULL, FALSE),
  (45, 'Beef Seasoning', NULL, '2.0000', 'kg', NULL, '2026-03-19 16:14:31.470', NULL, FALSE),
  (46, 'Chicken Seasoning ', 'Carnizone Chicken Seasoning', '2.6260', 'kg', '', '2026-03-21 10:27:14.122', 90, FALSE),
  (47, 'Test Spice Rub XQ7', '', '0.5000', 'kg', '', '2026-03-25 04:43:42.804', 1, FALSE);


-- TABLE: recipes (11 rows)
INSERT INTO recipes (id, name, description, servings, serving_unit, category, notes, created_at, pack_size, rrp, packaging_cost, labour_cost, portions_per_batch, shelf_life_days, tin_size, max_batches_per_tin, sop_url, fill_weight_grams, base_type, base_weight_grams, is_core_menu, color, is_current_special) VALUES
  (1, 'Margherita', 'Neapolitan-inspired 24-hour dough on our signature tomato base, fresh basil and beautifully creamy Fior di Latte mozzarella.', '1.0000', 'portion', 'Calzones', '', '2026-03-18 09:39:37.664', '2.0000', '10.7000', '0.4000', '2.5000', 10, 13, 'XXL', 10, '', NULL, NULL, NULL, FALSE, '#d19900', FALSE),
  (2, 'Chicken and Chorizo', 'Piri piri chicken, sliced chorizo, feta, red pepper, red onion, fresh basil and mozzarella on our spicy tomato base.', '1.0000', 'portion', 'Calzones', '', '2026-03-19 12:42:04.415', '2.0000', '13.1500', '0.4000', '3.0000', 10, 13, 'XXL', 10, '', NULL, NULL, NULL, FALSE, '#ff7300', FALSE),
  (3, 'BBQ Pulled Pork ', 'Slow roasted BBQ pulled pork, rosemary and mozzarella on a sweet and smokey BBQ base.', '1.0000', 'portion', 'Calzones', '', '2026-03-19 15:30:46.055', '2.0000', '12.6500', '0.4000', '3.0000', 10, 13, 'XL', 15, '', NULL, NULL, NULL, TRUE, '#ff00ea', FALSE),
  (4, 'The Godfather', 'Locally sourced brisket, chuck and short rib 100% beef burger patty, ‘Sauce Shop’ burger sauce, gherkins, caramelised red onion chutney and mozzarella on our signature tomato base.', '1.0000', 'portion', 'Calzones', '', '2026-03-19 15:54:43.832', '2.0000', '13.9000', '0.4000', '3.0000', 10, 13, 'XXL', 10, '', NULL, NULL, NULL, FALSE, '#0d0d0d', FALSE),
  (5, 'Carnizone', 'Ground spicy beef, seasoned chicken, pepperoni, creamy fior di latte and a drizzle of honey. Sweet, mildly spicy and irresistibly meat-heavy.', '1.0000', 'portion', 'Calzones', '', '2026-03-19 16:16:05.821', '2.0000', '16.9500', '0.4000', '3.0000', 10, 13, 'XXL', 6, '', NULL, NULL, NULL, FALSE, '#b30000', FALSE),
  (6, 'Balsamic Roasted Vegetables', 'Balsamic roasted mushrooms, peppers, red onions and courgette all topped with mozzarella on our signature tomato base.', '1.0000', 'portion', 'Calzones', '', '2026-03-20 08:01:28.013', '2.0000', '10.9500', '0.4000', '3.0000', 10, 13, 'XL', 7, '', NULL, NULL, NULL, TRUE, '#6600ff', FALSE),
  (7, 'New Yorker', 'Traditionally prepared pastrami with sliced gherkins American mustard and mozzarella on our signature tomato base', '1.0000', 'portion', 'Calzones', '', '2026-03-20 20:17:18.083', '2.0000', '13.9500', '0.4000', '3.0000', 10, 0, 'XXL', 12, '', NULL, NULL, NULL, FALSE, '#ebb800', FALSE),
  (8, 'The Donald', 'Gressingham Peking shredded duck with a rich and sweet Hoisin sauce, spring onions, and creamy Fior Di Latte mozzarella.', '1.0000', 'portion', 'Calzones', '', '2026-03-21 14:44:15.111', '2.0000', '14.7500', '0.4000', '3.0000', 10, 13, 'XXL', 5, '', NULL, NULL, NULL, FALSE, '#ff00a2', FALSE),
  (9, 'Chilli Chorizo & Fior Di Latte', 'A double portion of shredded chorizo with fresh sliced red chillies and creamy fior di latte mozzarella on our signature spicy base (medium spice level).', '1.0000', 'portion', 'Calzones', '', '2026-03-21 15:11:31.052', '1.0000', '12.6500', '0.4000', '3.0000', 10, 0, 'XXL', 10, '', NULL, NULL, NULL, FALSE, '#ff0000', FALSE),
  (10, 'Garlic Cheese Calzones (V)', 'Roasted garlic herb confit with mozzarella and mature cheddar in our 24-hour Neapolitan-inspired dough, topped with our own garlic and parsley butter.', '1.0000', 'portion', 'Calzones', 'Roasted garlic herb confit with mozzarella and mature cheddar in our 24-hour Neapolitan-inspired dough, topped with our own garlic and parsley butter.', '2026-03-21 15:13:29.715', '1.0000', '10.4500', '0.4000', '3.0000', 10, 0, 'XXL', 10, '', NULL, NULL, NULL, TRUE, '#219712', FALSE),
  (11, 'The Don Burger', '', '1.0000', 'portion', 'Calzones', '', '2026-03-23 17:04:29.246', '1.0000', '17.9500', '0.4000', '3.0000', 10, 10, 'N/A', 10, '', NULL, NULL, NULL, FALSE, '#000000', FALSE);


-- TABLE: storage_racks (0 rows)
-- storage_racks: no rows


-- TABLE: recipe_ingredients (53 rows)
INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, quantity, marinade_for_ingredient_id, include_in_filling_mix) VALUES
  (325, 3, 22, '0.0825', NULL, TRUE),
  (326, 3, 47, '0.0750', NULL, FALSE),
  (327, 3, 45, '0.0450', NULL, TRUE),
  (328, 3, 19, '0.0010', NULL, FALSE),
  (329, 3, 45, '0.0060', 22, FALSE),
  (363, 6, 28, '12.0000', NULL, TRUE),
  (364, 6, 16, '0.0220', NULL, TRUE),
  (365, 6, 14, '0.0220', NULL, TRUE),
  (366, 6, 12, '0.0220', NULL, TRUE),
  (367, 6, 13, '0.0200', NULL, TRUE),
  (368, 6, 47, '0.0750', NULL, FALSE),
  (371, 1, 7, '0.0870', NULL, TRUE),
  (372, 1, 18, '0.9024', NULL, FALSE),
  (411, 11, 210, '0.0850', NULL, FALSE),
  (412, 11, 47, '0.0230', NULL, FALSE),
  (413, 11, 208, '0.0300', NULL, FALSE),
  (414, 11, 207, '0.0180', NULL, FALSE),
  (415, 11, 206, '0.0150', NULL, FALSE),
  (416, 11, 209, '0.0520', NULL, FALSE),
  (417, 11, 59, '0.0150', NULL, FALSE),
  (495, 2, 47, '0.0750', NULL, FALSE),
  (496, 2, 13, '0.0140', NULL, TRUE),
  (497, 2, 23, '15.0000', NULL, TRUE),
  (498, 2, 34, '10.0000', NULL, TRUE),
  (499, 2, 31, '0.0020', NULL, FALSE),
  (500, 2, 191, '0.0600', NULL, TRUE),
  (501, 2, 12, '0.0120', NULL, TRUE),
  (502, 2, 18, '0.9000', NULL, FALSE),
  (514, 4, 47, '0.0570', NULL, FALSE),
  (515, 4, 56, '0.0570', NULL, TRUE),
  (516, 4, 57, '0.0190', NULL, TRUE),
  (517, 4, 58, '0.0240', NULL, FALSE),
  (518, 4, 59, '0.0110', NULL, FALSE),
  (534, 7, 47, '0.0750', NULL, FALSE),
  (535, 7, 193, '0.0500', NULL, TRUE),
  (536, 7, 57, '0.0200', NULL, TRUE),
  (537, 7, 139, '0.0060', NULL, FALSE),
  (538, 10, 47, '0.0470', NULL, TRUE),
  (539, 10, 77, '0.0470', NULL, TRUE),
  (540, 5, 7, '0.0750', NULL, TRUE),
  (541, 5, 191, '0.0380', NULL, TRUE),
  (542, 5, 205, '0.0020', NULL, FALSE),
  (543, 5, 204, '0.0370', NULL, TRUE),
  (544, 5, 11, '0.0240', NULL, FALSE),
  (545, 5, 97, '12.0000', NULL, FALSE),
  (546, 9, 7, '0.0760', NULL, TRUE),
  (547, 9, 23, '38.0000', NULL, TRUE),
  (548, 9, 72, '0.0070', NULL, TRUE),
  (549, 8, 49, '0.0370', NULL, TRUE),
  (550, 8, 24, '0.0600', NULL, TRUE),
  (551, 8, 15, '0.0200', NULL, TRUE),
  (552, 8, 7, '0.0700', NULL, TRUE),
  (553, 8, 27, '0.0070', NULL, TRUE);


-- TABLE: recipe_sub_recipes (23 rows)
INSERT INTO recipe_sub_recipes (id, recipe_id, sub_recipe_id, quantity, marinade_for_ingredient_id, include_in_filling_mix) VALUES
  (130, 3, 1, '0.1150', NULL, FALSE),
  (131, 3, 42, '0.0010', 22, TRUE),
  (141, 6, 1, '0.1150', NULL, FALSE),
  (142, 6, 2, '0.0300', NULL, TRUE),
  (146, 1, 1, '0.1150', NULL, FALSE),
  (147, 1, 2, '0.0430', NULL, TRUE),
  (164, 11, 2, '0.0180', NULL, FALSE),
  (165, 11, 1, '0.1150', NULL, FALSE),
  (195, 2, 1, '0.1150', NULL, FALSE),
  (196, 2, 2, '0.0360', NULL, TRUE),
  (201, 4, 1, '0.1150', NULL, FALSE),
  (202, 4, 2, '0.0360', NULL, TRUE),
  (209, 7, 1, '0.1150', NULL, FALSE),
  (210, 7, 2, '0.0360', NULL, TRUE),
  (211, 10, 1, '0.1150', NULL, FALSE),
  (212, 10, 44, '0.0190', NULL, TRUE),
  (213, 10, 43, '0.0073', NULL, FALSE),
  (214, 5, 1, '0.1150', NULL, FALSE),
  (215, 5, 45, '0.0030', NULL, FALSE),
  (216, 5, 2, '0.0360', NULL, TRUE),
  (217, 9, 1, '0.1150', NULL, FALSE),
  (218, 9, 2, '0.0380', NULL, TRUE),
  (219, 8, 1, '0.1150', NULL, FALSE);


-- TABLE: recipe_meat_marinades (0 rows)
-- recipe_meat_marinades: no rows


-- TABLE: recipe_shopify_mappings (0 rows)
-- recipe_shopify_mappings: no rows


-- TABLE: sub_recipe_ingredients (38 rows)
INSERT INTO sub_recipe_ingredients (id, sub_recipe_id, ingredient_id, quantity) VALUES
  (78, 41, 27, '1.4430'),
  (79, 41, 3, '0.3000'),
  (80, 41, 41, '591.0000'),
  (81, 41, 38, '545.0000'),
  (82, 41, 39, '148.0000'),
  (83, 42, 3, '1.0000'),
  (84, 42, 27, '1.0000'),
  (85, 42, 128, '1000.0000'),
  (96, 43, 65, '0.2500'),
  (97, 43, 86, '20.0000'),
  (98, 43, 25, '0.0010'),
  (99, 43, 66, '1.0000'),
  (100, 44, 63, '3.0000'),
  (101, 44, 3, '0.0160'),
  (102, 44, 38, '31.0000'),
  (103, 44, 19, '6.0000'),
  (104, 44, 62, '6.0000'),
  (105, 44, 25, '0.7500'),
  (106, 45, 128, '534.0000'),
  (107, 45, 73, '356.0000'),
  (108, 45, 38, '356.0000'),
  (109, 45, 87, '0.2370'),
  (110, 45, 43, '178.0000'),
  (111, 45, 40, '178.0000'),
  (112, 45, 42, '71.0000'),
  (113, 45, 3, '0.0890'),
  (114, 46, 41, '1313.0000'),
  (115, 46, 3, '1.3130'),
  (116, 46, 40, '375.0000'),
  (117, 1, 3, '0.4500'),
  (118, 1, 25, '0.6300'),
  (119, 1, 32, '20.0000'),
  (120, 1, 33, '15.0000'),
  (121, 1, 95, '11.6650'),
  (122, 47, 79, '0.1000'),
  (123, 2, 26, '5.0000'),
  (124, 2, 95, '2.1820'),
  (125, 2, 37, '4000.0000');


-- TABLE: sub_recipe_sub_recipes (1 rows)
INSERT INTO sub_recipe_sub_recipes (id, sub_recipe_id, component_sub_recipe_id, quantity) VALUES
  (37, 2, 41, '0.6560');


-- TABLE: dpt_settings (10 rows)
INSERT INTO dpt_settings (id, recipe_id, default_batches_per_day, is_active, updated_at, surplus_percent, packs_sold) VALUES
  (1, 3, '0.00', TRUE, '2026-03-22 17:22:01.115', '20.00', 1273),
  (2, 5, '0.00', TRUE, '2026-03-22 17:22:01.340', '20.00', 800),
  (3, 2, '0.00', TRUE, '2026-03-22 17:22:01.481', '20.00', 1077),
  (4, 1, '0.00', TRUE, '2026-03-22 17:22:01.905', '20.00', 998),
  (5, 4, '0.00', TRUE, '2026-03-22 17:22:02.391', '20.00', 891),
  (6, 6, '0.00', TRUE, '2026-03-22 17:22:00.984', '20.00', 387),
  (7, 7, '0.00', TRUE, '2026-03-22 17:22:02.052', '20.00', 699),
  (8, 9, '0.00', TRUE, '2026-03-22 17:22:01.622', '20.00', 615),
  (9, 10, '0.00', TRUE, '2026-03-22 17:22:01.761', '20.00', 500),
  (10, 8, '0.00', TRUE, '2026-03-22 17:22:02.199', '20.00', 700);


-- TABLE: kanban_items (0 rows)
-- kanban_items: no rows


-- TABLE: ingredient_storage_locations (0 rows)
-- ingredient_storage_locations: no rows


-- ── Step 3: reset sequences to max(id) + 1 ────────────────────
SELECT setval(pg_get_serial_sequence('suppliers', 'id'), COALESCE((SELECT MAX(id) FROM suppliers), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('storage_locations', 'id'), COALESCE((SELECT MAX(id) FROM storage_locations), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('stock_item_categories', 'id'), COALESCE((SELECT MAX(id) FROM stock_item_categories), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('category_defaults', 'id'), COALESCE((SELECT MAX(id) FROM category_defaults), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('timing_standards', 'id'), COALESCE((SELECT MAX(id) FROM timing_standards), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('app_settings', 'id'), COALESCE((SELECT MAX(id) FROM app_settings), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('ingredients', 'id'), COALESCE((SELECT MAX(id) FROM ingredients), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('sub_recipes', 'id'), COALESCE((SELECT MAX(id) FROM sub_recipes), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('recipes', 'id'), COALESCE((SELECT MAX(id) FROM recipes), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('storage_racks', 'id'), COALESCE((SELECT MAX(id) FROM storage_racks), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('stock_items', 'id'), COALESCE((SELECT MAX(id) FROM stock_items), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('recipe_ingredients', 'id'), COALESCE((SELECT MAX(id) FROM recipe_ingredients), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('recipe_sub_recipes', 'id'), COALESCE((SELECT MAX(id) FROM recipe_sub_recipes), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('recipe_meat_marinades', 'id'), COALESCE((SELECT MAX(id) FROM recipe_meat_marinades), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('recipe_shopify_mappings', 'id'), COALESCE((SELECT MAX(id) FROM recipe_shopify_mappings), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('sub_recipe_ingredients', 'id'), COALESCE((SELECT MAX(id) FROM sub_recipe_ingredients), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('sub_recipe_sub_recipes', 'id'), COALESCE((SELECT MAX(id) FROM sub_recipe_sub_recipes), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('dpt_settings', 'id'), COALESCE((SELECT MAX(id) FROM dpt_settings), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('delivery_check_configs', 'id'), COALESCE((SELECT MAX(id) FROM delivery_check_configs), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('kanban_items', 'id'), COALESCE((SELECT MAX(id) FROM kanban_items), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('ingredient_storage_locations', 'id'), COALESCE((SELECT MAX(id) FROM ingredient_storage_locations), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('postcode_validations', 'id'), COALESCE((SELECT MAX(id) FROM postcode_validations), 0) + 1, false);
