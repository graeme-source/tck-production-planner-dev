-- ============================================================
-- TCK Production Seed
-- Generated: 2026-03-30T17:50:26.561Z
--
-- !! WARNING: For a FRESHLY-PROVISIONED production database only !!
-- TRUNCATE … CASCADE also clears dependent tables such as:
-- production_plan_items, prep_completions, batch_completions,
-- daily_stock_checks, temperature_records, oven_events, etc.
-- Do NOT run against a database with live operational data.
--
-- Apply via psql:
--   psql "$PRODUCTION_DATABASE_URL" < prod-seed.sql
--
-- Or POST to /api/admin/apply-seed (see MIGRATION.md).
-- ============================================================

-- ── Step 1: clear seed tables (CASCADE clears FK-dependent tables) ──
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
INSERT INTO category_defaults (id, category, default_packaging_cost, default_labour_cost, created_at, default_pack_size) VALUES
  (1, 'Calzones', '0.4000', '3.0000', '2026-03-19 14:43:37.682', 2);


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


-- TABLE: app_settings (17 rows)
INSERT INTO app_settings (id, key, value, updated_at) VALUES
  (1221, 'admin_plan_date_override', 'false', '2026-03-27 07:20:50.745'),
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
  (8, 'default_break_minutes', '15', '2026-03-30 13:50:45.419'),
  (4149, 'default_lunch_minutes', '45', '2026-03-30 13:50:45.419'),
  (1241, 'may_contain_statement', 'May also contain traces of nuts, peanuts, egg, soya, celery, sulphites, mustard, wheat and milk', '2026-03-27 08:51:17.588'),
  (1, 'mixer_capacity_kg', '25', '2026-03-20 05:43:38.020'),
  (92, 'production_order_recipe_ids', '[1,10,6,5,4,2,3,9,7,8]', '2026-03-26 15:41:41.020'),
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
INSERT INTO ingredients (id, name, unit, cost_per_pack, notes, created_at, pack_weight, brand, supplier_part_number, supplier_id, secondary_supplier_id, ordering_url, processing_ratio, raw_meat_tray_capacity_kg, category, stock_check_enabled, stock_check_frequency, stock_check_day, min_cooking_temp_c, estimated_cook_time_min, oven_temp_c, steam_pct, surplus_percent, shelf_life_days, kanban_enabled, kanban_quantity, kanban_unit, kanban_order_amount, perishable, pallet_size, energy_kj, energy_kcal, fat, saturates, carbohydrate, sugars, protein, salt, label_declaration, allergens, fibre, prep_weight_mode, qr_code_url) VALUES
  (3, 'Salt', 'kg', '7.8500', NULL, '2026-03-17 17:27:12.929', '6.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '1.0000', 'weight', '2.0000', TRUE, NULL, '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '99.80', 'Salt', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-3.png'),
  (7, 'Fior Di Latte', 'kg', '49.9900', NULL, '2026-03-18 09:14:31.112', '10.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '550.00', NULL, TRUE, '40.0000', 'weight', NULL, TRUE, NULL, '1132.00', '271.00', '17.70', '11.10', '3.10', '1.40', '25.30', '0.63', 'Fior Di Latte Cheese (Milk)', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-7.png'),
  (11, 'Pepperoni', 'kg', '10.2800', NULL, '2026-03-19 09:57:55.886', '1.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '4.0000', 'weight', '4.0000', TRUE, NULL, '1979.00', '476.00', '40.20', '14.80', '3.10', '1.10', '24.80', '3.60', 'Pepperoni (Pork, Spices, Salt, Dextrose, Garlic Powder, Smoke Flavouring)', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-11.png'),
  (12, 'Red peppers', 'kg', '13.9500', 'Vegetables', '2026-03-19 09:57:55.900', '5.0000', NULL, NULL, 5, 1, NULL, '0.8470', NULL, 'vegetable', TRUE, 'daily', NULL, NULL, NULL, NULL, NULL, '215.00', 5, FALSE, '0.0000', 'weight', NULL, TRUE, NULL, '130.00', '31.00', '0.30', '0.00', '6.00', '4.20', '1.00', '0.01', 'Red Pepper', '', '2.10', 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-12.png'),
  (13, 'Red Onions', 'kg', '3.0500', 'Vegetables', '2026-03-19 09:57:55.902', '1.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', TRUE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, FALSE, '0.0000', 'weight', NULL, TRUE, NULL, '163.00', '39.00', '0.10', '0.00', '7.90', '5.60', '1.20', '0.01', 'Red Onion', '', '1.70', 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-13.png'),
  (14, 'Mushrooms', 'kg', '8.2000', 'Vegetables', '2026-03-19 09:57:55.906', '2.5000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '100.00', 5, FALSE, '0.0000', 'weight', NULL, TRUE, NULL, '55.00', '13.00', '0.50', '0.10', '0.40', '0.20', '1.80', '0.02', 'Mushrooms', '', '1.00', 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-14.png'),
  (15, 'Spring Onions', 'kg', '5.8000', 'Vegetables', '2026-03-19 09:57:55.908', '1.0000', NULL, NULL, 5, NULL, NULL, '0.8700', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '100.00', 5, FALSE, '0.0000', 'weight', NULL, TRUE, NULL, '138.00', '33.00', '0.20', '0.00', '5.70', '2.80', '1.80', '0.04', 'Spring Onion', '', '2.60', 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-15.png'),
  (16, 'Courgettes', 'kg', '10.9500', 'Vegetables', '2026-03-19 09:57:55.912', '5.0000', NULL, NULL, 5, NULL, NULL, '0.9569', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '215.00', 5, FALSE, '0.0000', 'weight', NULL, TRUE, NULL, '71.00', '17.00', '0.30', '0.10', '1.80', '1.70', '1.20', '0.02', 'Courgette', '', '1.00', 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-16.png'),
  (17, 'Tomatoes', 'kg', '10.9500', 'Vegetables', '2026-03-19 09:57:55.916', '6.0000', NULL, NULL, 5, NULL, NULL, '0.8744', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-17.png'),
  (18, 'Basil', 'g', '1.7900', 'Herbs and Spices', '2026-03-19 09:57:55.919', '100.0000', NULL, NULL, 5, NULL, NULL, '0.6016', NULL, 'vegetable', TRUE, 'daily', NULL, NULL, NULL, NULL, NULL, '125.00', NULL, FALSE, '0.0000', 'weight', NULL, TRUE, NULL, '96.00', '23.00', '0.60', '0.00', '1.30', '0.30', '3.20', '0.01', 'Basil', '', '1.60', 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-18.png'),
  (19, 'Rosemary', 'g', '1.7900', NULL, '2026-03-19 09:57:55.921', '100.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '250.00', NULL, TRUE, '3.0000', 'weight', '4.0000', TRUE, NULL, '544.00', '131.00', '5.90', '2.60', '6.60', '0.00', '3.30', '0.06', 'Rosemary', '', '14.10', 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-19.png'),
  (20, 'Goats Cheese', 'kg', '13.9500', 'Cheese', '2026-03-19 09:57:55.935', '1.0000', NULL, NULL, NULL, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-20.png'),
  (21, 'Chicken', 'kg', '5.3900', NULL, '2026-03-19 09:57:55.941', '1.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, TRUE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '1.0000', 'weight', '2000.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-21.png'),
  (22, 'Pork', 'kg', '5.8500', 'Meat', '2026-03-19 09:57:55.944', '1.0000', NULL, NULL, 3, NULL, NULL, '0.7300', '6.0000', 'raw_meat', TRUE, 'daily', NULL, '75.00', 180, 155, 70, '30.00', NULL, FALSE, '0.0000', 'weight', NULL, TRUE, NULL, '519.00', '123.00', '4.00', '1.40', '0.00', '0.00', '21.20', '0.16', 'Pork', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-22.png'),
  (23, 'Chorizo', 'g', '5.5500', NULL, '2026-03-19 09:57:55.952', '500.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '24.0000', 'weight', '40.0000', TRUE, NULL, '1815.00', '437.00', '38.30', '14.30', '1.90', '1.80', '21.80', '3.30', 'Chorizo (Pork, Paprika, Garlic, Salt, Spices)', '', '0.90', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-23.png'),
  (24, 'Duck', 'kg', '11.9900', NULL, '2026-03-19 09:57:55.956', '1.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '50.0000', 'weight', '50.0000', TRUE, NULL, '769.00', '184.00', '10.00', '3.50', '0.00', '0.00', '23.50', '0.15', 'Duck', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-24.png'),
  (25, 'Olive Oil', 'kg', '39.9900', NULL, '2026-03-19 09:57:55.962', '5.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '5.0000', 'weight', '5.0000', TRUE, NULL, '3701.00', '884.00', '100.00', '14.20', '0.00', '0.00', '0.00', '0.00', 'Olive Oil', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-25.png'),
  (26, 'Passata (Rodolfi)', 'kg', '16.5000', 'Base', '2026-03-19 09:57:55.969', '10.0000', NULL, NULL, 10, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '700.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, '109.00', '26.00', '0.10', '0.00', '4.30', '3.80', '1.30', '0.04', 'Tomato Passata (Tomatoes)', '', '1.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-26.png'),
  (27, 'Demerrera Sugar', 'kg', '7.8500', 'Herbs and Spices', '2026-03-19 09:57:55.971', '3.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, '1630.00', '389.00', '0.00', '0.00', '97.30', '97.30', '0.00', '0.01', 'Demerara Sugar', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-27.png'),
  (28, 'Balsamic Glaze', 'g', '2.6200', NULL, '2026-03-19 09:57:55.973', '500.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '10.0000', 'weight', '11.0000', TRUE, NULL, '754.00', '178.00', '0.00', '0.00', '43.00', '38.00', '0.50', '0.08', 'Balsamic Glaze (Balsamic Vinegar of Modena (Wine Vinegar, Grape Must), Glucose-Fructose Syrup)', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-28.png'),
  (29, 'Artichoke (drained weight)', 'g', '3.0000', 'Vegetables', '2026-03-19 09:57:55.978', '540.0000', NULL, NULL, NULL, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-29.png'),
  (30, 'Jalapenos (Drained weight)', 'kg', '5.6900', 'Vegetables', '2026-03-19 09:57:55.981', '3.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-30.png'),
  (31, 'Piri Piri Glaze (MRC)', 'kg', '18.3900', NULL, '2026-03-19 09:57:55.989', '2.5000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '2.0000', 'weight', '3.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Piri Piri Glaze', '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-31.png'),
  (32, 'Flour (00)', 'kg', '16.6900', 'Dough', '2026-03-19 09:57:55.994', '15.0000', 'Caputo Blue', NULL, 2, NULL, 'www.adimaria.co.uk', '1.0000', NULL, 'dough', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, '1468.00', '348.00', '1.20', '0.20', '73.30', '1.70', '11.50', '0.00', 'Wheat Flour (Type 00)', '', '2.70', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-32.png'),
  (33, 'Yeast', 'g', '4.2500', 'Dough', '2026-03-19 09:57:55.998', '500.0000', NULL, NULL, 10, NULL, NULL, '1.0000', NULL, 'dough', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '1500.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, '1296.00', '310.00', '4.00', '0.60', '41.20', '0.00', '40.40', '0.12', 'Yeast', '', '26.90', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-33.png'),
  (34, 'Feta', 'g', '13.4900', NULL, '2026-03-19 09:57:56.001', '900.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '4.0000', 'weight', '6.0000', TRUE, NULL, '1103.00', '264.00', '21.30', '14.90', '1.50', '1.50', '17.20', '2.50', 'Feta Cheese (Milk)', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-34.png'),
  (35, 'Chives', 'g', '0.7000', 'Herbs and Spices', '2026-03-19 09:57:56.004', '30.0000', NULL, NULL, NULL, NULL, NULL, '1.0000', NULL, 'herb', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-35.png'),
  (36, 'Sliced Black Olives', 'g', '0.7500', 'Vegetables', '2026-03-19 09:57:56.008', '170.0000', NULL, NULL, NULL, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-36.png'),
  (37, 'Tomato Puree (paste)', 'g', '2.4300', NULL, '2026-03-19 09:57:56.012', '800.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '700.00', NULL, TRUE, '3.0000', 'weight', NULL, TRUE, NULL, '347.00', '82.00', '0.40', '0.10', '13.10', '11.50', '4.30', '0.17', 'Tomato Purée (Tomatoes)', '', '4.10', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-37.png'),
  (38, 'Garlic Granules', 'g', '6.1200', NULL, '2026-03-19 09:57:56.016', '700.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '3.0000', 'weight', '1.0000', TRUE, NULL, '1389.00', '331.00', '0.70', '0.10', '72.70', '2.40', '16.60', '0.08', 'Garlic Granules', '', '9.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-38.png'),
  (39, 'Ground black pepper', 'g', '6.1200', NULL, '2026-03-19 09:57:56.019', '500.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '3.0000', 'weight', '4.0000', TRUE, NULL, '1059.00', '255.00', '3.30', '1.40', '38.30', '0.60', '10.40', '0.05', 'Black Pepper', '', '25.30', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-39.png'),
  (40, 'Course Black Pepper', 'g', '6.2600', NULL, '2026-03-19 09:57:56.022', '500.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '3.0000', 'weight', '6.0000', TRUE, NULL, '1059.00', '255.00', '3.30', '1.40', '38.30', '0.60', '10.40', '0.05', 'Cracked Black Pepper', '', '25.30', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-40.png'),
  (41, 'Paprika', 'g', '4.1500', NULL, '2026-03-19 09:57:56.026', '550.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '6.0000', 'weight', '6.0000', TRUE, NULL, '1172.00', '282.00', '12.90', '2.10', '34.80', '10.30', '14.10', '0.08', 'Paprika', '', '34.90', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-41.png'),
  (42, 'Chilli powder', 'g', '4.4500', NULL, '2026-03-19 09:57:56.029', '400.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '3.0000', 'weight', '1.0000', TRUE, NULL, '1172.00', '282.00', '14.30', '2.50', '29.30', '7.20', '13.50', '0.77', 'Chilli Powder', '', '34.80', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-42.png'),
  (43, 'Oregano', 'g', '3.0600', NULL, '2026-03-19 09:57:56.032', '150.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '3.0000', 'weight', '3.0000', TRUE, NULL, '1087.00', '265.00', '4.30', '1.60', '26.00', '4.10', '9.00', '0.06', 'Oregano', '', '42.50', 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-43.png'),
  (44, 'Mixed Herbs', 'g', '3.0200', NULL, '2026-03-19 09:57:56.034', '150.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '3.0000', 'weight', '3.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-44.png'),
  (45, 'BBQ Sauce (lion sticky)', 'kg', '7.3900', NULL, '2026-03-19 09:57:56.036', '2.2000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'weekly', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '4.0000', 'pack', '6.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'BBQ Sauce (Sugar, Tomato Purée, Spirit Vinegar, Molasses, Modified Maize Starch, Salt, Mustard Flour, Spices, Garlic Powder, Smoke Flavouring)', '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-45.png'),
  (46, 'Mayonnaise', 'kg', '24.1300', NULL, '2026-03-19 09:57:56.039', '10.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '3.0000', 'weight', '4.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-46.png'),
  (47, 'Mozzarella', 'kg', '47.9900', NULL, '2026-03-19 09:57:56.042', '12.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '470.00', NULL, TRUE, '72.0000', 'weight', NULL, TRUE, NULL, '1132.00', '271.00', '17.70', '11.10', '3.10', '1.40', '25.30', '0.63', 'Mozzarella Cheese (Milk)', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-47.png'),
  (48, 'Crushed chillis', 'g', '5.2600', 'Herbs and Spices', '2026-03-19 09:57:56.045', '300.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-48.png'),
  (49, 'Hoisin Sauce', 'kg', '7.7600', NULL, '2026-03-19 09:57:56.049', '2.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '9.0000', 'weight', '10.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Hoisin Sauce (Water, Sugar, Soya Beans, Modified Corn Starch, Salt, Sesame Oil, Garlic, Chilli, Spices)', '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-49.png'),
  (50, 'White onions', 'kg', '16.5000', NULL, '2026-03-19 09:57:56.052', '20.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '5.0000', 'weight', '5.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-50.png'),
  (51, 'Rib Meat', 'kg', '15.0000', 'Meat', '2026-03-19 09:57:56.058', '1.0000', NULL, NULL, NULL, NULL, NULL, '1.0000', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-51.png'),
  (52, 'Ghekins', 'kg', '3.8900', 'Vegetables', '2026-03-19 09:57:56.063', '1.3500', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-52.png'),
  (53, 'Pomodori Peeled Plum Tomatoes', 'kg', '2.6400', 'Vegetables', '2026-03-19 09:57:56.067', '2.5000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-53.png'),
  (54, 'Minced Garlic', 'kg', '5.1900', 'Herbs and Spices', '2026-03-19 09:57:56.070', '1.3600', NULL, NULL, NULL, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-54.png'),
  (55, 'Lemon Juice (Quick lemon)', 'kg', '2.4400', NULL, '2026-03-19 09:57:56.073', '1.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '6.0000', 'weight', '6.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-55.png'),
  (56, 'Burger Meat', 'kg', '9.9000', 'Meat', '2026-03-19 09:57:56.076', '1.0000', NULL, NULL, 3, NULL, NULL, '0.7000', '2.9000', 'raw_meat', TRUE, 'daily', NULL, '70.00', 30, 150, 70, '250.00', NULL, FALSE, '0.0000', 'weight', NULL, TRUE, NULL, '893.00', '214.00', '15.20', '6.30', '0.00', '0.00', '19.30', '0.18', 'Beef', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-56.png'),
  (57, 'Gherkin (drained weight)', 'kg', '7.0400', 'Vegetables', '2026-03-19 09:57:56.078', '1.3800', NULL, NULL, 9, 1, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, '67.00', '16.00', '0.10', '0.00', '2.00', '1.10', '0.50', '1.60', 'Gherkin', '', '1.00', 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-57.png'),
  (58, 'Red Onion Chutney', 'kg', '9.4800', NULL, '2026-03-19 09:57:56.081', '1.2500', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '12.0000', 'pack', '13.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Red Onion Chutney', '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-58.png'),
  (59, 'Burger Sauce', 'kg', '15.0000', NULL, '2026-03-19 09:57:56.086', '2.1000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '6.0000', 'weight', '10.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Burger Sauce', '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-59.png'),
  (60, 'Garlic Puree', 'kg', '4.2300', 'Herbs and Spices', '2026-03-19 09:57:56.091', '1.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-60.png'),
  (61, 'Grated matture Cheddar', 'kg', '5.4300', 'Cheese', '2026-03-19 09:57:56.095', '1.0000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '200.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-61.png'),
  (62, 'Dried Thyme', 'g', '3.0900', 'Herbs and Spices', '2026-03-19 09:57:56.099', '180.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'herb', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, '1138.00', '276.00', '7.40', '2.70', '26.90', '1.70', '9.10', '0.06', 'Dried Thyme', '', '37.00', 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-62.png'),
  (63, 'Garlic Cloves fresh peeled', 'kg', '5.4100', NULL, '2026-03-19 09:57:56.102', '1.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '7.0000', 'weight', '10.0000', TRUE, NULL, '620.00', '149.00', '0.50', '0.10', '29.30', '1.00', '6.40', '0.04', 'Garlic', '', '2.10', 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-63.png'),
  (64, 'Frozen dough balls', 'kg', '42.9900', NULL, '2026-03-19 09:57:56.105', '5.5850', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '1.0000', 'weight', '3.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-64.png'),
  (65, 'Salted Butter', 'kg', '68.5000', 'Dairy', '2026-03-19 09:57:56.109', '10.0000', NULL, NULL, 5, 9, NULL, '1.0000', NULL, 'dairy', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, '3059.00', '744.00', '82.20', '52.10', '0.60', '0.60', '0.60', '1.50', 'Salted Butter (Milk)', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-65.png'),
  (66, 'Dried Parsley', 'g', '2.7400', 'Herbs and Spices', '2026-03-19 09:57:56.112', '120.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'herb', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, '1132.00', '271.00', '5.50', '1.00', '28.60', '7.30', '26.60', '0.45', 'Dried Parsley', '', '26.70', 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-66.png'),
  (67, 'Meahs Tikka Sauce', 'kg', '18.9900', 'Sauces', '2026-03-19 09:57:56.115', '3.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-67.png'),
  (68, 'Green Peppers', 'kg', '13.9500', 'Vegetables', '2026-03-19 09:57:56.117', '5.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-68.png'),
  (69, 'Greek Yoghurt', 'kg', '7.2500', 'Dairy', '2026-03-19 09:57:56.119', '1.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'dairy', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-69.png'),
  (70, 'Special Sausage', 'kg', '6.5000', 'Meat', '2026-03-19 09:57:56.121', '1.0000', NULL, NULL, NULL, NULL, NULL, '0.8700', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-70.png'),
  (71, 'Pancetta', 'kg', '11.5000', NULL, '2026-03-19 09:57:56.124', '1.0000', NULL, NULL, NULL, NULL, NULL, '0.6600', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-71.png'),
  (72, 'Red Chillis', 'kg', '33.6500', 'Vegetables', '2026-03-19 09:57:56.127', '3.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '200.00', 5, FALSE, '0.0000', 'weight', NULL, TRUE, NULL, '167.00', '40.00', '0.40', '0.10', '6.10', '3.40', '1.90', '0.02', 'Red Chilli', '', '1.50', 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-72.png'),
  (73, 'Ground Cumin', 'g', '4.6200', NULL, '2026-03-19 09:57:56.130', '400.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '6.0000', 'weight', '6.0000', TRUE, NULL, '1567.00', '375.00', '22.30', '1.50', '33.70', '2.30', '17.80', '0.17', 'Ground Cumin', '', '10.50', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-73.png'),
  (74, 'Ground Nutmeg', 'g', '13.5600', 'Herbs and Spices', '2026-03-19 09:57:56.133', '500.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-74.png'),
  (75, 'Dried Basil', 'g', '2.9200', NULL, '2026-03-19 09:57:56.136', '150.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '3.0000', 'weight', '1.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-75.png'),
  (76, 'Beef Bouillion', 'kg', '19.9600', 'Herbs and Spices', '2026-03-19 09:57:56.139', '1.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-76.png'),
  (77, 'Matture Cheddar', 'kg', '14.9500', 'Dairy', '2026-03-19 09:57:56.142', '2.0000', NULL, NULL, 5, 9, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, FALSE, '0.0000', 'weight', NULL, TRUE, NULL, '1725.00', '416.00', '34.90', '21.70', '0.10', '0.10', '25.40', '1.80', 'Mature Cheddar Cheese (Milk)', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-77.png'),
  (78, 'Braising Beef', 'kg', '9.9000', 'Meat', '2026-03-19 09:57:56.145', '1.0000', NULL, NULL, 1, NULL, NULL, '1.0000', '3.5000', 'raw_meat', TRUE, 'daily', NULL, '70.00', 240, 155, 70, '10.00', NULL, FALSE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-78.png'),
  (79, 'Calzone Dough', 'kg', '0.8500', NULL, '2026-03-19 09:57:56.152', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'dough', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Calzone Dough', '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-79.png'),
  (81, 'Spicy Base', 'kg', '2.8300', NULL, '2026-03-19 09:57:56.158', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-81.png'),
  (82, 'Buttermilk Fried Chicken Strip', 'kg', '0.6900', NULL, '2026-03-19 09:57:56.160', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-82.png'),
  (83, 'Whole Milk', 'kg', '2.7900', NULL, '2026-03-19 09:57:56.162', '2.2700', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '0.00', NULL, TRUE, '1.0000', 'weight', '1.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-83.png'),
  (84, 'Spicy Breading', 'kg', '56.1400', NULL, '2026-03-19 09:57:56.167', '7.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '3.0000', 'weight', '6.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-84.png'),
  (85, 'Panko Breadcrumbs', 'kg', '4.5400', NULL, '2026-03-19 09:57:56.170', '1.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '1.0000', 'weight', '5.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-85.png'),
  (86, 'Garlic Powder', 'g', '4.7000', NULL, '2026-03-19 09:57:56.173', '500.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '3.0000', 'weight', '6.0000', TRUE, NULL, '1389.00', '331.00', '0.70', '0.10', '72.70', '2.40', '16.60', '0.08', 'Garlic Powder', '', '9.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-86.png'),
  (87, 'Onion Powder', 'kg', '14.8900', NULL, '2026-03-19 09:57:56.175', '2.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '6.0000', 'weight', '6.0000', TRUE, NULL, '1431.00', '341.00', '1.00', '0.20', '79.10', '6.60', '10.40', '0.08', 'Onion Powder', '', '15.20', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-87.png'),
  (88, 'Ground Ginger', 'g', '4.9100', NULL, '2026-03-19 09:57:56.178', '450.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-88.png'),
  (89, 'Madras Curry Powder', 'g', '3.4700', NULL, '2026-03-19 09:57:56.181', '450.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-89.png'),
  (90, 'Turmeric', 'g', '4.5800', NULL, '2026-03-19 09:57:56.185', '500.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-90.png'),
  (91, 'Katsu Spice Mix', 'g', '0.0000', NULL, '2026-03-19 09:57:56.188', '770.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-91.png'),
  (92, 'Hoisin Sauce (Blue Dragon)', 'kg', '6.4600', NULL, '2026-03-19 09:57:56.194', '1.2500', 'Blue Dragon', NULL, 19, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-92.png'),
  (93, 'Carrots (Grated)', 'kg', '2.7500', NULL, '2026-03-19 09:57:56.198', '1.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-93.png'),
  (94, 'Chicken Boullion', 'kg', '15.9100', NULL, '2026-03-19 09:57:56.200', '1.0200', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-94.png'),
  (95, 'Tap Water', 'kg', '0.0000', NULL, '2026-03-19 09:57:56.203', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', 'Water', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-95.png'),
  (96, 'Dark Soy Sauce', 'kg', '6.9900', NULL, '2026-03-19 09:57:56.209', '1.7500', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', '4.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-96.png'),
  (97, 'Honey (CR)', 'g', '3.3900', NULL, '2026-03-19 09:57:56.212', '680.0000', 'Country Range', NULL, 9, NULL, NULL, '0.9500', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, '1381.00', '329.00', '0.00', '0.00', '81.50', '81.50', '0.30', '0.01', 'Honey', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-97.png'),
  (98, 'Plain Flour', 'kg', '11.4900', NULL, '2026-03-19 09:57:56.214', '16.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '760.00', NULL, TRUE, '1.0000', 'weight', '1.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-98.png'),
  (99, 'Carrots (Diced)', 'kg', '2.7500', NULL, '2026-03-19 09:57:56.217', '1.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-99.png'),
  (100, 'Baby Back Pork Ribs', 'kg', '72.0000', NULL, '2026-03-19 09:57:56.219', '10.0000', NULL, NULL, NULL, NULL, NULL, '1.0000', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-100.png'),
  (101, 'Yangnyeom Korean Sauce', 'kg', '4.3700', NULL, '2026-03-19 09:57:56.223', '1.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '300.0000', 'weight', '600.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-101.png'),
  (102, 'Basil puree', 'kg', '14.7300', NULL, '2026-03-19 09:57:56.226', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-102.png'),
  (103, 'Nacho Cheese Sauce', 'kg', '20.6300', NULL, '2026-03-19 09:57:56.229', '1.5640', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '20.0000', 'weight', '30.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-103.png'),
  (104, 'Philly Beef Mix', 'kg', '13.9800', NULL, '2026-03-19 09:57:56.232', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-104.png'),
  (105, 'Ham (sliced gammon)', 'g', '4.4900', NULL, '2026-03-19 09:57:56.235', '530.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '15.0000', 'weight', '20.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-105.png'),
  (106, 'Branston Pickle', 'kg', '14.5500', NULL, '2026-03-19 09:57:56.237', '2.5500', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '4.0000', 'weight', '4.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-106.png'),
  (107, 'Chargrilled peppers', 'kg', '12.7000', NULL, '2026-03-19 09:57:56.240', '1.9000', NULL, NULL, 10, NULL, NULL, '0.5900', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-107.png'),
  (108, 'Chargrilled Aubergines', 'kg', '12.7000', NULL, '2026-03-19 09:57:56.242', '1.9000', NULL, NULL, 10, NULL, NULL, '0.5300', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-108.png'),
  (109, 'Chargrilled Artichokes', 'kg', '10.9800', NULL, '2026-03-19 09:57:56.245', '1.0000', NULL, NULL, 5, NULL, NULL, '0.9500', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-109.png'),
  (110, 'Corn flour', 'kg', '13.7200', NULL, '2026-03-19 09:57:56.250', '5.0000', NULL, NULL, NULL, NULL, 'https://www.buywholefoodsonline.co.uk/cornflour-corn-starch.html', '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-110.png'),
  (111, 'Corn Starch', 'kg', '13.7200', NULL, '2026-03-19 09:57:56.253', '5.0000', NULL, NULL, NULL, NULL, 'https://www.buywholefoodsonline.co.uk/cornflour-corn-starch.html', '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-111.png'),
  (112, 'Potato Starch', 'kg', '11.6900', NULL, '2026-03-19 09:57:56.255', '2.0000', NULL, NULL, NULL, NULL, 'https://www.buywholefoodsonline.co.uk/organic-potato-starch.html', '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-112.png'),
  (113, 'Skimmed Milk Powder', 'kg', '11.5500', NULL, '2026-03-19 09:57:56.259', '2.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'dairy', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-113.png'),
  (114, 'Egg White Powder', 'kg', '29.9500', NULL, '2026-03-19 09:57:56.264', '1.0000', NULL, NULL, 22, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-114.png'),
  (115, 'Icing Sugar', 'kg', '7.2300', NULL, '2026-03-19 09:57:56.267', '3.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '1.0000', 'weight', '2.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-115.png'),
  (116, 'Marinade Spice Mix', 'kg', '11.2800', NULL, '2026-03-19 09:57:56.270', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-116.png'),
  (117, 'Red Cooking Wine', 'kg', '6.9500', NULL, '2026-03-19 09:57:56.272', '5.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '3.0000', 'weight', '4.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-117.png'),
  (118, 'White Cooking Wine', 'kg', '6.9500', NULL, '2026-03-19 09:57:56.275', '5.0000', NULL, NULL, 10, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-118.png'),
  (119, 'Fresh Thyme', 'g', '1.7900', NULL, '2026-03-19 09:57:56.278', '100.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '3.0000', 'weight', '3.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-119.png'),
  (120, 'Beef Gravy Granules', 'kg', '15.5500', NULL, '2026-03-19 09:57:56.281', '1.8000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-120.png'),
  (121, 'Beef Welly Mix', 'kg', '10.1300', NULL, '2026-03-19 09:57:56.284', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-121.png'),
  (122, 'Chestnut Mushrooms', 'kg', '10.9500', NULL, '2026-03-19 09:57:56.287', '2.2700', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '6.0000', 'weight', '7.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-122.png'),
  (123, 'Mushroom Duxelle', 'kg', '11.4700', NULL, '2026-03-19 09:57:56.289', '1.3250', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-123.png'),
  (124, 'Spicy Chicken', 'kg', '10.0000', NULL, '2026-03-19 09:57:56.292', '1.0000', NULL, NULL, NULL, NULL, NULL, '0.8000', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-124.png'),
  (125, 'Streaky Bacon', 'kg', '12.0000', NULL, '2026-03-19 09:57:56.294', '1.0000', NULL, NULL, NULL, NULL, NULL, '0.5200', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-125.png'),
  (126, 'Red Onion Gravy', 'kg', '2.0900', NULL, '2026-03-19 09:57:56.297', '1.0000', NULL, NULL, 17, NULL, NULL, '0.9400', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-126.png'),
  (127, 'Cranberry', 'kg', '8.9000', NULL, '2026-03-19 09:57:56.300', '2.5000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '2.0000', 'weight', '4.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-127.png'),
  (128, 'Smoked paprika', 'g', '7.2500', NULL, '2026-03-19 09:57:56.305', '750.0000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, '1172.00', '282.00', '12.90', '2.10', '34.80', '10.30', '14.10', '0.08', 'Smoked Paprika', '', '34.90', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-128.png'),
  (129, 'Peeled Shallots', 'kg', '9.2000', NULL, '2026-03-19 09:57:56.308', '1.0000', NULL, NULL, 5, NULL, NULL, '0.9500', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-129.png'),
  (130, 'Red Wine', 'g', '5.3700', NULL, '2026-03-19 09:57:56.311', '750.0000', NULL, NULL, 10, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-130.png'),
  (131, 'Dried Cranberries', 'kg', '10.8900', NULL, '2026-03-19 09:57:56.313', '1.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'herb', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-131.png'),
  (132, 'Riccota', 'kg', '10.1300', NULL, '2026-03-19 09:57:56.316', '1.5000', NULL, NULL, 9, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-132.png'),
  (133, 'Baby Spinach', 'kg', '12.4900', NULL, '2026-03-19 09:57:56.318', '2.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-133.png'),
  (134, 'TCK Roasted Red peppers', 'kg', '13.9500', NULL, '2026-03-19 09:57:56.321', '1.0000', NULL, NULL, 17, NULL, NULL, '0.5100', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-134.png'),
  (135, 'TCK Roasted Mushroons', 'kg', '10.9500', NULL, '2026-03-19 09:57:56.325', '2.5000', NULL, NULL, 17, NULL, NULL, '0.6000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-135.png'),
  (136, 'Cauliflower', 'kg', '29.5000', NULL, '2026-03-19 09:57:56.328', '5.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-136.png'),
  (137, 'Cinnamon', 'g', '7.5700', NULL, '2026-03-19 09:57:56.330', '450.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '50.0000', 'weight', '100.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-137.png'),
  (138, 'Roasted Red Peppers', 'kg', '12.2900', NULL, '2026-03-19 09:57:56.333', '2.2000', NULL, NULL, 5, NULL, NULL, '0.9500', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-138.png'),
  (139, 'American Mustard', 'kg', '27.9600', NULL, '2026-03-19 09:57:56.339', '11.6000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '2.0000', 'weight', '2.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'American Mustard (Water, Spirit Vinegar, Mustard Seed, Salt, Turmeric, Paprika, Garlic Powder)', '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-139.png'),
  (140, 'Vegetable Oil', 'kg', '25.9900', NULL, '2026-03-19 09:57:56.342', '20.0000', 'KTC', NULL, 2, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-140.png'),
  (141, 'Broccoli (prepared)', 'kg', '17.5000', NULL, '2026-03-19 09:57:56.344', '2.5000', NULL, NULL, 5, NULL, NULL, '0.7400', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-141.png'),
  (142, 'Taleggio', 'kg', '9.6900', NULL, '2026-03-19 09:57:56.346', '1.0000', NULL, NULL, 10, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-142.png'),
  (143, 'Bechemel', 'kg', '6.0700', NULL, '2026-03-19 09:57:56.349', '1.0000', NULL, NULL, 9, NULL, NULL, '0.9800', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-143.png'),
  (144, 'Dijon Mustard', 'kg', '13.0100', NULL, '2026-03-19 09:57:56.352', '2.2700', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '1.0000', 'weight', '1.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-144.png'),
  (145, 'Gorgonzola Dolce', 'kg', '15.1200', NULL, '2026-03-19 09:57:56.354', '1.6000', NULL, NULL, 10, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-145.png'),
  (146, 'Cider Vinegar', 'kg', '8.5300', NULL, '2026-03-19 09:57:56.356', '5.0000', NULL, NULL, 23, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-146.png'),
  (147, 'Tamari Soy Sauce (UPF Free)', 'kg', '24.9900', NULL, '2026-03-19 09:57:56.359', '6.0000', NULL, NULL, 23, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-147.png'),
  (148, 'Balsamic Vinegar', 'kg', '14.7500', NULL, '2026-03-19 09:57:56.362', '5.0000', NULL, NULL, 5, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-148.png'),
  (149, 'Hoisin Sauce (Knorr)', 'kg', '22.5800', NULL, '2026-03-19 09:57:56.364', '2.2000', 'Knorrs', NULL, 23, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-149.png'),
  (150, 'Hoisin Sauce (Bidfood Everyday)', 'kg', '25.2100', NULL, '2026-03-19 09:57:56.366', '7.8000', 'Bidfood Everyday', NULL, 23, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-150.png'),
  (151, 'Diced Chicken Thigh', 'kg', '19.6500', NULL, '2026-03-19 09:57:56.369', '2.5000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-151.png'),
  (152, 'Tikka Paste', 'kg', '10.9400', NULL, '2026-03-19 09:57:56.371', '1.1000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-152.png'),
  (153, 'Smoked Bacon Lardons', 'kg', '55.4300', NULL, '2026-03-19 09:57:56.373', '10.0000', NULL, NULL, 1, NULL, NULL, '0.5500', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-153.png'),
  (154, 'Diced Beef', 'kg', '25.8400', NULL, '2026-03-19 09:57:56.376', '2.5000', NULL, 'C 136642', 1, NULL, NULL, '1.0000', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-154.png'),
  (155, 'Szechuan Concentrated Sauce', 'kg', '12.1600', NULL, '2026-03-19 09:57:56.378', '1.0000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-155.png'),
  (156, 'Beef Strips', 'kg', '36.5700', NULL, '2026-03-19 09:57:56.380', '2.5000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-156.png'),
  (157, 'Rice Vinegar', 'kg', '12.3000', NULL, '2026-03-19 09:57:56.383', '3.0000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-157.png'),
  (158, 'Garlic Puree (Brakes)', 'kg', '10.2200', NULL, '2026-03-19 09:57:56.386', '1.2000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-158.png'),
  (159, 'Chilli Oil', 'kg', '18.0000', NULL, '2026-03-19 09:57:56.388', '1.0200', NULL, NULL, 22, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-159.png'),
  (160, 'Cream Cheese', 'kg', '17.6300', NULL, '2026-03-19 09:57:56.391', '2.0000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-160.png'),
  (161, 'Vanilla Extract', 'g', '5.5400', NULL, '2026-03-19 09:57:56.394', '500.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '1.0000', 'weight', '1.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-161.png'),
  (162, 'Parmesan', 'kg', '23.1000', NULL, '2026-03-19 09:57:56.396', '1.0000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-162.png'),
  (163, 'Pineapple', 'kg', '15.4100', NULL, '2026-03-19 09:57:56.398', '2.5000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-163.png'),
  (164, 'Ham Hock', 'kg', '9.9900', NULL, '2026-03-19 09:57:56.400', '1.0000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-164.png'),
  (165, 'Bechemel (Macphie)', 'kg', '38.3500', NULL, '2026-03-19 09:57:56.403', '10.0000', NULL, 'A 9036', 1, NULL, NULL, '0.9800', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-165.png'),
  (166, 'Garlic Confit', 'kg', '22.7400', NULL, '2026-03-19 09:57:56.406', '2.7250', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '2.0000', 'weight', '5.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-166.png'),
  (167, 'Jerk BBQ Sauce', 'kg', '8.9200', NULL, '2026-03-19 09:57:56.408', '1.0000', NULL, NULL, 1, NULL, NULL, '0.9700', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-167.png'),
  (168, 'Chipotle paste', 'g', '10.1400', NULL, '2026-03-19 09:57:56.411', '750.0000', 'Santa Maria', NULL, 1, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-168.png'),
  (169, 'Santa Maria BBQ Sauce', 'kg', '6.1100', NULL, '2026-03-19 09:57:56.413', '1.1000', 'Santa Maria', NULL, 1, NULL, NULL, '0.9700', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-169.png'),
  (170, 'Ranch', 'kg', '9.5700', NULL, '2026-03-19 09:57:56.415', '2.2700', 'Lion', NULL, 1, NULL, NULL, '0.9700', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-170.png'),
  (171, 'Mango Chutney', 'kg', '5.3900', NULL, '2026-03-19 09:57:56.418', '1.5000', 'Geetas', NULL, 1, NULL, NULL, '0.9700', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-171.png'),
  (172, 'Chickpeas', 'kg', '3.4500', NULL, '2026-03-19 09:57:56.420', '1.5000', 'Royal Crown', NULL, 1, NULL, NULL, '1.0000', NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-172.png'),
  (173, 'Curry Powder', 'g', '7.9100', NULL, '2026-03-19 09:57:56.423', '500.0000', 'Sysco', NULL, 1, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-173.png'),
  (174, 'Tajin Classico Seasoning with Lime', 'g', '6.2300', NULL, '2026-03-19 09:57:56.425', '400.0000', 'Tajin', NULL, 22, NULL, NULL, '1.0000', NULL, 'spice', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-174.png'),
  (175, 'Fresh Coriander', 'kg', '9.8400', NULL, '2026-03-19 09:57:56.427', '1.0000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'herb', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-175.png'),
  (176, 'Red Wine Vinegar', 'kg', '10.7200', NULL, '2026-03-19 09:57:56.429', '5.0000', NULL, NULL, 1, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-176.png'),
  (177, 'G''s Piri Piri Sauce', 'kg', '7.5200', NULL, '2026-03-19 09:57:56.432', '1.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-177.png'),
  (178, 'Lime Juice', 'kg', '5.1000', NULL, '2026-03-19 09:57:56.435', '1.0000', 'Village Press', NULL, 1, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-178.png'),
  (179, 'Sirloin Steak', 'kg', '33.2800', NULL, '2026-03-19 09:57:56.437', '1.7000', NULL, 'C 136847', 1, NULL, NULL, '0.8000', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-179.png'),
  (180, 'Red cooking wine (Sysco)', 'kg', '37.9400', NULL, '2026-03-19 09:57:56.440', '10.0000', NULL, 'A 25690', 1, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-180.png'),
  (181, 'White Cooking Wine (Sysco)', 'kg', '36.7800', NULL, '2026-03-19 09:57:56.442', '10.0000', NULL, 'A 25696', 1, NULL, NULL, '1.0000', NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-181.png'),
  (182, 'Prosciutto', 'kg', '16.9900', NULL, '2026-03-19 09:57:56.446', '1.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '5.0000', 'weight', '5.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-182.png'),
  (183, 'Red Wine Gravy (2025)', 'g', '0.7900', NULL, '2026-03-19 09:57:56.449', '87.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-183.png'),
  (184, 'Sirloin Steak Center Cut', 'kg', '18.2100', NULL, '2026-03-19 09:57:56.451', '1.1350', NULL, 'C 5010975', 1, NULL, NULL, '0.5550', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-184.png'),
  (185, 'Fillet steak (Sysco whole)', 'kg', '64.2400', NULL, '2026-03-19 09:57:56.453', '2.1000', NULL, 'C 133991', 1, NULL, NULL, '0.8000', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-185.png'),
  (186, 'BBQ Shredded Turkey & Cranberry', 'g', '4.1300', NULL, '2026-03-19 09:57:56.455', '500.0000', NULL, 'F 150200', 1, NULL, NULL, '1.0000', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-186.png'),
  (187, 'Turkey Saddle', 'kg', '31.0000', NULL, '2026-03-19 09:57:56.461', '3.5000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '4.0000', 'weight', '5.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-187.png'),
  (188, 'Pork, Sage & Onion Stuffing Balls', 'kg', '29.4100', NULL, '2026-03-19 09:57:56.464', '2.8800', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '4.0000', 'weight', '6.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-188.png'),
  (189, 'Pigs In Blankets', 'kg', '15.5000', NULL, '2026-03-19 09:57:56.466', '1.0000', NULL, 'F 120676', 1, NULL, NULL, '0.7900', NULL, 'cooked_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '30.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-189.png'),
  (190, 'Cranberry Sauce', 'kg', '12.9500', NULL, '2026-03-19 09:57:56.468', '2.5000', NULL, 'A 100357', 1, NULL, NULL, '1.0000', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-190.png'),
  (191, 'Diced Chicken fillet', 'kg', '16.5900', NULL, '2026-03-19 09:57:56.471', '2.5000', NULL, 'C 70946', 1, NULL, 'https://www.brake.co.uk/meat-poultry/chilled-butchered-poultry/chicken/chicken-mince-diced-strips/prime-meats-british-red-tractor-diced-chicken-breast/p/70946?term=diced&#x20;chicken&#x20;fillet', '0.8700', '4.0000', 'raw_meat', TRUE, 'daily', NULL, '75.00', 30, 170, 70, '30.00', NULL, FALSE, '0.0000', 'weight', NULL, TRUE, NULL, '460.00', '110.00', '1.30', '0.30', '0.00', '0.00', '23.10', '0.15', 'Chicken Breast', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-191.png'),
  (192, 'Beef Bouillon Paste', 'kg', '13.7400', NULL, '2026-03-19 09:57:56.473', '1.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '2.0000', 'weight', '3.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-192.png'),
  (193, 'Pastrami (Sliced)', 'kg', '20.9700', NULL, '2026-03-19 09:57:56.477', '1.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '25.0000', 'weight', '25.0000', TRUE, NULL, '560.00', '133.00', '4.80', '1.60', '2.00', '1.80', '21.00', '2.50', 'Pastrami (Beef, Salt, Sugar, Spices, Smoke Flavouring)', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-193.png'),
  (194, 'Macaroni', 'kg', '4.6800', NULL, '2026-03-19 09:57:56.480', '3.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '1.0000', 'weight', '2.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-194.png'),
  (195, 'Red Leicester Cheese', 'kg', '24.9800', NULL, '2026-03-19 09:57:56.482', '2.5000', NULL, '9827', 9, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-195.png'),
  (196, 'Matture Cheddar Block', 'kg', '32.6800', NULL, '2026-03-19 09:57:56.485', '4.7500', NULL, 'C 71144', 1, NULL, NULL, '1.0000', NULL, 'cheese', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-196.png'),
  (197, 'Evaporated Milk', 'g', '1.1800', NULL, '2026-03-19 09:57:56.487', '410.0000', NULL, 'A25002', 1, NULL, NULL, '1.0000', NULL, 'dairy', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-197.png'),
  (198, 'Extra Matture Cheddar', 'kg', '22.1800', NULL, '2026-03-19 09:57:56.490', '2.4400', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '10.0000', 'weight', '15.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-198.png'),
  (199, 'Double Cream', 'kg', '8.9900', NULL, '2026-03-19 09:57:56.492', '2.2700', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '0.00', NULL, TRUE, '2.0000', 'weight', '3.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-199.png'),
  (200, 'Beef Short Rib (Best Butchers)', 'kg', '12.5000', NULL, '2026-03-19 09:57:56.494', '1.0000', NULL, NULL, NULL, NULL, NULL, '0.5000', NULL, 'raw_meat', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-200.png'),
  (201, 'Knorr Korma Sauce', 'kg', '11.5400', NULL, '2026-03-19 09:57:56.497', '1.1000', NULL, 'A 85659', 1, NULL, NULL, '0.9800', NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-201.png'),
  (202, 'Garlic Butter', 'g', '1.9600', NULL, '2026-03-19 09:57:56.499', '271.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '1.0000', 'weight', '4.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-202.png'),
  (203, 'Honey Sriracha', 'kg', '40.0000', NULL, '2026-03-19 09:57:56.502', '5.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '4.0000', 'weight', '6.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-203.png'),
  (204, 'Minced Beef', 'kg', '13.9100', NULL, '2026-03-19 09:57:56.504', '2.5000', NULL, 'F 32680', 1, NULL, NULL, '0.8500', '2.5000', 'raw_meat', FALSE, 'daily', NULL, '70.00', 30, 170, 70, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, '893.00', '214.00', '15.20', '6.30', '0.00', '0.00', '19.30', '0.18', 'Minced Beef', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-204.png'),
  (205, 'Chicken Seasoning Mix', 'kg', '21.3800', NULL, '2026-03-19 09:57:56.507', '3.0000', NULL, NULL, 17, NULL, NULL, '1.0000', NULL, 'seasoning', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Chicken Seasoning Mix', '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-205.png'),
  (206, 'Cheeky Gluten Free Crispy Fried Onions', 'kg', '6.9100', NULL, '2026-03-23 17:09:49.528', '1.0000', 'Cheeky', '136733', 1, NULL, 'https://www.brake.co.uk/dry-store/cooking-ingredients/herbs-spices-seasonings/blends-other-seasonings/cheeky-gluten-free-crispy-fried-onions/p/136733', NULL, NULL, 'vegetable', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', 5, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Crispy Fried Onions (Onion, Palm Oil, Rice Flour, Salt)', '', NULL, 'processed', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-206.png'),
  (207, 'Brakes Chilli Jam', 'kg', '9.8700', NULL, '2026-03-23 17:10:17.021', '1.2500', 'Brakes', '126918', 1, NULL, 'https://www.brake.co.uk/dry-store/condiments-pickles/chutney-relish-pickles/chutney-relish/brakes-chilli-jam/p/126918', NULL, NULL, 'sauce', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Chilli Jam', '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-207.png'),
  (208, 'Streky Bacon', 'kg', '9.9900', NULL, '2026-03-23 17:11:02.220', '1.0000', NULL, 'NFS', NULL, NULL, NULL, NULL, NULL, 'other', FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '0.0000', 'weight', NULL, TRUE, NULL, '1156.00', '278.00', '22.30', '8.20', '0.50', '0.50', '18.50', '2.90', 'Streaky Bacon (Pork Belly, Salt, Sugar, Preservative: Sodium Nitrite)', '', '0.00', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-208.png'),
  (209, 'Sysco Classic Grated Monterey Jack Cheese', 'kg', '6.9900', NULL, '2026-03-23 17:21:22.760', '1.0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, 'daily', NULL, NULL, NULL, NULL, NULL, '10.00', NULL, TRUE, '3.0000', 'weight', '4.0000', TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Monterey Jack Cheese (Milk, Salt, Cultures, Enzyme)', '', NULL, 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-209.png'),
  (210, 'Beef Burgers', 'kg', '6.7900', NULL, '2026-03-23 17:26:33.316', '1.0000', 'NFS', NULL, NULL, NULL, NULL, NULL, '2.1000', 'raw_meat', TRUE, 'daily', NULL, '70.00', 30, 170, 50, '10.00', NULL, FALSE, '0.0000', 'weight', NULL, TRUE, NULL, '1050.00', '252.00', '17.30', '7.20', '4.80', '0.50', '19.50', '1.20', 'Beef Burger (Beef, Seasoning, Salt)', '', '0.50', 'raw', '/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-210.png');


-- TABLE: stock_items (0 rows)
-- stock_items: no rows


-- TABLE: delivery_check_configs (0 rows)
-- delivery_check_configs: no rows


-- TABLE: sub_recipes (9 rows)
INSERT INTO sub_recipes (id, name, description, yield, yield_unit, notes, created_at, shelf_life_days, is_base, label_declaration) VALUES
  (1, 'Calzone Dough', '', '32.7600', 'kg', '20kg Flour Mix', '2026-03-17 17:30:37.829', 3, FALSE, NULL),
  (2, 'Tomato Base', 'TCK Signature Tomato Base', '11.8380', 'kg', 'Needs base mix adding as sub recipe', '2026-03-18 09:38:47.728', 0, TRUE, NULL),
  (41, 'Normal Base Dry Mix', 'Dry spice mix for TCK Signature normal base', '3.0270', 'kg', '', '2026-03-19 11:27:06.116', NULL, FALSE, NULL),
  (42, 'Pork Rub', '', '1.0000', 'kg', '', '2026-03-19 14:50:42.689', NULL, FALSE, NULL),
  (43, 'Garlic Butter', NULL, '0.2710', 'kg', NULL, '2026-03-19 15:58:57.192', NULL, FALSE, NULL),
  (44, 'Garlic Confit', NULL, '3.8090', 'kg', NULL, '2026-03-19 16:00:48.266', NULL, FALSE, NULL),
  (45, 'Beef Seasoning', NULL, '2.0000', 'kg', NULL, '2026-03-19 16:14:31.470', NULL, FALSE, NULL),
  (46, 'Chicken Seasoning ', 'Carnizone Chicken Seasoning', '2.6260', 'kg', '', '2026-03-21 10:27:14.122', 90, FALSE, NULL),
  (47, 'Test Spice Rub XQ7', '', '0.5000', 'kg', '', '2026-03-25 04:43:42.804', 1, FALSE, NULL);


-- TABLE: recipes (11 rows)
INSERT INTO recipes (id, name, description, servings, serving_unit, category, notes, created_at, pack_size, rrp, packaging_cost, labour_cost, portions_per_batch, shelf_life_days, tin_size, max_batches_per_tin, sop_url, fill_weight_grams, base_type, base_weight_grams, is_core_menu, color, is_current_special, cooking_loss_percent) VALUES
  (1, 'Margherita', 'Neapolitan-inspired 24-hour dough on our signature tomato base, fresh basil and beautifully creamy Fior di Latte mozzarella.', '1.0000', 'portion', 'Calzones', '', '2026-03-18 09:39:37.664', '2.0000', '10.7000', '0.4000', '2.5000', 10, 13, 'XXL', 10, '', NULL, NULL, NULL, FALSE, '#d19900', FALSE, '3.00'),
  (2, 'Chicken and Chorizo', 'Piri piri chicken, sliced chorizo, feta, red pepper, red onion, fresh basil and mozzarella on our spicy tomato base.', '1.0000', 'portion', 'Calzones', '', '2026-03-19 12:42:04.415', '2.0000', '13.1500', '0.4000', '3.0000', 10, 13, 'XXL', 10, '', NULL, NULL, NULL, FALSE, '#ff7300', FALSE, '3.00'),
  (3, 'BBQ Pulled Pork ', 'Slow roasted BBQ pulled pork, rosemary and mozzarella on a sweet and smokey BBQ base.', '1.0000', 'portion', 'Calzones', '', '2026-03-19 15:30:46.055', '2.0000', '12.6500', '0.4000', '3.0000', 10, 13, 'XL', 15, '', NULL, NULL, NULL, TRUE, '#ff00ea', FALSE, '3.00'),
  (4, 'The Godfather', 'Locally sourced brisket, chuck and short rib 100% beef burger patty, ‘Sauce Shop’ burger sauce, gherkins, caramelised red onion chutney and mozzarella on our signature tomato base.', '1.0000', 'portion', 'Calzones', '', '2026-03-19 15:54:43.832', '2.0000', '13.9000', '0.4000', '3.0000', 10, 13, 'XXL', 10, '', NULL, NULL, NULL, FALSE, '#0d0d0d', FALSE, '3.00'),
  (5, 'Carnizone', 'Ground spicy beef, seasoned chicken, pepperoni, creamy fior di latte and a drizzle of honey. Sweet, mildly spicy and irresistibly meat-heavy.', '1.0000', 'portion', 'Calzones', '', '2026-03-19 16:16:05.821', '2.0000', '16.9500', '0.4000', '3.0000', 10, 13, 'XXL', 6, '', NULL, NULL, NULL, FALSE, '#b30000', FALSE, '3.00'),
  (6, 'Balsamic Roasted Vegetables', 'Balsamic roasted mushrooms, peppers, red onions and courgette all topped with mozzarella on our signature tomato base.', '1.0000', 'portion', 'Calzones', '', '2026-03-20 08:01:28.013', '2.0000', '10.9500', '0.4000', '3.0000', 10, 13, 'XL', 7, '', NULL, NULL, NULL, TRUE, '#6600ff', FALSE, '3.00'),
  (7, 'New Yorker', 'Traditionally prepared pastrami with sliced gherkins American mustard and mozzarella on our signature tomato base', '1.0000', 'portion', 'Calzones', '', '2026-03-20 20:17:18.083', '2.0000', '13.9500', '0.4000', '3.0000', 10, 0, 'XXL', 12, '', NULL, NULL, NULL, FALSE, '#ebb800', FALSE, '3.00'),
  (8, 'The Donald', 'Gressingham Peking shredded duck with a rich and sweet Hoisin sauce, spring onions, and creamy Fior Di Latte mozzarella.', '1.0000', 'portion', 'Calzones', '', '2026-03-21 14:44:15.111', '2.0000', '14.7500', '0.4000', '3.0000', 10, 13, 'XXL', 5, '', NULL, NULL, NULL, FALSE, '#ff00a2', FALSE, '3.00'),
  (9, 'Chorizo Chilli & Fior Di Latte', 'A double portion of shredded chorizo with fresh sliced red chillies and creamy fior di latte mozzarella on our signature spicy base (medium spice level).', '1.0000', 'portion', 'Calzones', '', '2026-03-21 15:11:31.052', '2.0000', '12.6500', '0.4000', '3.0000', 10, 0, 'XXL', 10, '', NULL, NULL, NULL, FALSE, '#ff0000', FALSE, '3.00'),
  (10, 'Garlic Cheese Calzones (V)', 'Roasted garlic herb confit with mozzarella and mature cheddar in our 24-hour Neapolitan-inspired dough, topped with our own garlic and parsley butter.', '1.0000', 'portion', 'Calzones', 'Roasted garlic herb confit with mozzarella and mature cheddar in our 24-hour Neapolitan-inspired dough, topped with our own garlic and parsley butter.', '2026-03-21 15:13:29.715', '2.0000', '10.4500', '0.4000', '3.0000', 10, 0, 'XXL', 10, '', NULL, NULL, NULL, TRUE, '#219712', FALSE, '3.00'),
  (11, 'The Don Burger', '', '1.0000', 'portion', 'Calzones', '', '2026-03-23 17:04:29.246', '2.0000', '17.9500', '0.4000', '3.0000', 10, 10, 'M', 10, '', NULL, NULL, NULL, FALSE, '#000000', FALSE, '3.00');


-- TABLE: storage_racks (0 rows)
-- storage_racks: no rows


-- TABLE: recipe_ingredients (53 rows)
INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, quantity, marinade_for_ingredient_id, include_in_filling_mix, quid) VALUES
  (325, 3, 22, '0.0825', NULL, TRUE, FALSE),
  (326, 3, 47, '0.0750', NULL, FALSE, FALSE),
  (327, 3, 45, '0.0450', NULL, TRUE, FALSE),
  (328, 3, 19, '0.0010', NULL, FALSE, FALSE),
  (329, 3, 45, '0.0060', 22, FALSE, FALSE),
  (363, 6, 28, '12.0000', NULL, TRUE, FALSE),
  (364, 6, 16, '0.0220', NULL, TRUE, FALSE),
  (365, 6, 14, '0.0220', NULL, TRUE, FALSE),
  (366, 6, 12, '0.0220', NULL, TRUE, FALSE),
  (367, 6, 13, '0.0200', NULL, TRUE, FALSE),
  (368, 6, 47, '0.0750', NULL, FALSE, FALSE),
  (371, 1, 7, '0.0870', NULL, TRUE, FALSE),
  (372, 1, 18, '0.9024', NULL, FALSE, FALSE),
  (495, 2, 47, '0.0750', NULL, FALSE, FALSE),
  (496, 2, 13, '0.0140', NULL, TRUE, FALSE),
  (497, 2, 23, '15.0000', NULL, TRUE, FALSE),
  (498, 2, 34, '10.0000', NULL, TRUE, FALSE),
  (499, 2, 31, '0.0020', NULL, FALSE, FALSE),
  (500, 2, 191, '0.0600', NULL, TRUE, FALSE),
  (501, 2, 12, '0.0120', NULL, TRUE, FALSE),
  (502, 2, 18, '0.9000', NULL, FALSE, FALSE),
  (514, 4, 47, '0.0570', NULL, FALSE, FALSE),
  (515, 4, 56, '0.0570', NULL, TRUE, FALSE),
  (516, 4, 57, '0.0190', NULL, TRUE, FALSE),
  (517, 4, 58, '0.0240', NULL, FALSE, FALSE),
  (518, 4, 59, '0.0110', NULL, FALSE, FALSE),
  (534, 7, 47, '0.0750', NULL, FALSE, FALSE),
  (535, 7, 193, '0.0500', NULL, TRUE, FALSE),
  (536, 7, 57, '0.0200', NULL, TRUE, FALSE),
  (537, 7, 139, '0.0060', NULL, FALSE, FALSE),
  (549, 8, 49, '0.0370', NULL, TRUE, FALSE),
  (550, 8, 24, '0.0600', NULL, TRUE, FALSE),
  (551, 8, 15, '0.0200', NULL, TRUE, FALSE),
  (552, 8, 7, '0.0700', NULL, TRUE, FALSE),
  (553, 8, 27, '0.0070', NULL, TRUE, FALSE),
  (585, 9, 7, '0.0760', NULL, TRUE, FALSE),
  (586, 9, 23, '38.0000', NULL, TRUE, FALSE),
  (587, 9, 72, '0.0070', NULL, TRUE, FALSE),
  (595, 10, 47, '0.0470', NULL, TRUE, FALSE),
  (596, 10, 77, '0.0470', NULL, TRUE, FALSE),
  (597, 11, 210, '0.0850', NULL, FALSE, FALSE),
  (598, 11, 47, '0.0230', NULL, TRUE, FALSE),
  (599, 11, 208, '0.0300', NULL, FALSE, FALSE),
  (600, 11, 207, '0.0180', NULL, FALSE, FALSE),
  (601, 11, 206, '0.0150', NULL, FALSE, FALSE),
  (602, 11, 209, '0.0520', NULL, FALSE, FALSE),
  (603, 11, 59, '0.0150', NULL, FALSE, FALSE),
  (604, 5, 7, '0.0750', NULL, TRUE, FALSE),
  (605, 5, 191, '0.0380', NULL, TRUE, FALSE),
  (606, 5, 205, '0.0020', 191, FALSE, FALSE),
  (607, 5, 204, '0.0370', NULL, TRUE, FALSE),
  (608, 5, 11, '0.0240', NULL, FALSE, FALSE),
  (609, 5, 97, '12.0000', NULL, FALSE, FALSE);


-- TABLE: recipe_sub_recipes (23 rows)
INSERT INTO recipe_sub_recipes (id, recipe_id, sub_recipe_id, quantity, marinade_for_ingredient_id, include_in_filling_mix, quid) VALUES
  (130, 3, 1, '0.1150', NULL, FALSE, FALSE),
  (131, 3, 42, '0.0010', 22, TRUE, FALSE),
  (141, 6, 1, '0.1150', NULL, FALSE, FALSE),
  (142, 6, 2, '0.0300', NULL, TRUE, FALSE),
  (146, 1, 1, '0.1150', NULL, FALSE, FALSE),
  (147, 1, 2, '0.0430', NULL, TRUE, FALSE),
  (195, 2, 1, '0.1150', NULL, FALSE, FALSE),
  (196, 2, 2, '0.0360', NULL, TRUE, FALSE),
  (201, 4, 1, '0.1150', NULL, FALSE, FALSE),
  (202, 4, 2, '0.0360', NULL, TRUE, FALSE),
  (209, 7, 1, '0.1150', NULL, FALSE, FALSE),
  (210, 7, 2, '0.0360', NULL, TRUE, FALSE),
  (219, 8, 1, '0.1150', NULL, FALSE, FALSE),
  (230, 9, 1, '0.1150', NULL, FALSE, FALSE),
  (231, 9, 2, '0.0380', NULL, TRUE, FALSE),
  (234, 10, 1, '0.1150', NULL, FALSE, FALSE),
  (235, 10, 44, '0.0190', NULL, TRUE, FALSE),
  (236, 10, 43, '0.0073', NULL, FALSE, FALSE),
  (237, 11, 2, '0.0180', NULL, FALSE, FALSE),
  (238, 11, 1, '0.1150', NULL, FALSE, FALSE),
  (239, 5, 1, '0.1150', NULL, FALSE, FALSE),
  (240, 5, 45, '0.0030', 204, FALSE, FALSE),
  (241, 5, 2, '0.0360', NULL, TRUE, FALSE);


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


-- TABLE: kanban_items (188 rows)
INSERT INTO kanban_items (id, ingredient_id, supplier_id, status, pulled_at, pulled_by_user_id, order_day_target, notes, created_at, source_type, recipe_id, sub_recipe_id, qr_code_url) VALUES
  (1, 62, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (2, 139, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (3, 49, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (4, 204, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (5, 26, 10, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (6, 58, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (7, 209, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (8, 46, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (9, 20, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (10, 53, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (11, 55, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (12, 67, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (13, 61, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (14, 24, 2, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (15, 41, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (16, 50, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (17, 52, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (18, 68, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (19, 29, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (20, 129, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (21, 93, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (22, 99, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (23, 107, 10, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (24, 108, 10, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (25, 109, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (26, 122, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (27, 133, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (28, 134, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (29, 135, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (30, 136, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (31, 138, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (32, 54, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (33, 27, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (34, 32, 2, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (35, 38, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (36, 30, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (37, 25, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (38, 163, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (39, 206, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (40, 193, 24, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (41, 11, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (42, 31, 12, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (43, 45, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (44, 28, 10, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (45, 59, 16, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (46, 3, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (47, 65, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (48, 33, 10, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (49, 36, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (50, 141, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (51, 63, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (52, 57, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (53, 64, 2, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (54, 69, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (55, 51, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (56, 70, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (57, 149, 23, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (58, 150, 23, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (59, 170, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (60, 162, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (61, 164, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (62, 110, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (63, 111, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (64, 161, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (65, 40, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (66, 34, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (67, 7, 2, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (68, 39, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (69, 37, 10, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (70, 17, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (71, 172, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (72, 66, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (73, 60, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (74, 81, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (75, 92, 19, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (76, 103, 18, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (77, 123, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (78, 74, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (79, 121, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (80, 145, 10, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (81, 71, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (82, 85, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (83, 113, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (84, 82, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (85, 124, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (86, 114, 22, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (87, 76, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (88, 125, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (89, 115, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (90, 104, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (91, 94, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (92, 96, 20, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (93, 101, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (94, 102, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (95, 106, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (96, 120, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (97, 126, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (98, 143, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (99, 146, 23, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (100, 147, 23, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (101, 144, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (102, 116, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (103, 132, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (104, 142, 10, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (105, 117, 10, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (106, 118, 10, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (107, 127, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (108, 140, 2, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (109, 100, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (110, 98, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (111, 83, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (112, 87, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (113, 95, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (114, 79, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (115, 86, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (116, 73, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (117, 75, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (118, 131, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (119, 84, 18, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (120, 112, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (121, 200, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (122, 148, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (123, 159, 22, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (124, 166, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (125, 177, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (126, 203, 16, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (127, 152, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (128, 155, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (129, 157, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (130, 158, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (131, 183, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (132, 202, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (133, 174, 22, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (134, 153, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (135, 151, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (136, 154, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (137, 156, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (138, 160, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (139, 195, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (140, 167, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (141, 171, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (142, 165, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (143, 169, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (144, 176, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (145, 190, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (146, 192, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (147, 168, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (148, 48, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (149, 90, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (150, 137, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (151, 173, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (152, 186, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (153, 179, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (154, 184, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (155, 185, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (156, 187, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (157, 198, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (158, 178, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (159, 201, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (160, 88, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (161, 207, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (162, 205, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (163, 42, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (164, 23, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (165, 97, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (166, 128, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (167, 208, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (168, 35, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (169, 119, 5, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (170, 175, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (171, 89, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (172, 91, 17, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (173, 196, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (174, 105, 2, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (175, 182, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (176, 188, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (177, 197, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (178, 180, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (179, 181, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (180, 194, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (181, 130, 10, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (182, 189, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (183, 199, 1, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (184, 44, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (185, 43, 9, 'active', NULL, NULL, NULL, NULL, '2026-03-28 08:38:18.416', 'ingredient', NULL, NULL, NULL),
  (186, 21, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 11:10:27.577', 'ingredient', NULL, NULL, NULL),
  (187, 19, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 11:10:27.577', 'ingredient', NULL, NULL, NULL),
  (188, 47, NULL, 'active', NULL, NULL, NULL, NULL, '2026-03-28 11:10:27.577', 'ingredient', NULL, NULL, NULL);


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
