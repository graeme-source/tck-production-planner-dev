import app from "./app";
import { db, usersTable } from "@workspace/db";
import { sql, count } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { startBackupScheduler } from "./lib/backup";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function seedStorageLocations() {
  const SYSTEM_LOCATIONS = [
    { name: "Prep Fridge", zone: "fridge" },
    { name: "Raw Meat Fridge", zone: "fridge" },
    { name: "Raw Freezer", zone: "freezer" },
    { name: "Production Fridge", zone: "fridge" },
    { name: "Production Freezer", zone: "freezer" },
    { name: "Dry Store", zone: "ambient" },
  ];
  for (const loc of SYSTEM_LOCATIONS) {
    await db.execute(sql`
      INSERT INTO storage_locations (name, zone, is_system)
      SELECT ${loc.name}, ${loc.zone}, TRUE
      WHERE NOT EXISTS (SELECT 1 FROM storage_locations WHERE name = ${loc.name})
    `);
  }
}

async function runStartupMigrations() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_invites (
        id SERIAL PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        invited_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        invited_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        accepted_at TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS password_resets (
        id SERIAL PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP
      )
    `);
    // Add fulfilled_at to dispatch_orders if missing (added in v1.1)
    await db.execute(sql`
      ALTER TABLE dispatch_orders ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMP
    `);
    // Backfill fulfilled_at for already-fulfilled rows
    await db.execute(sql`
      UPDATE dispatch_orders SET fulfilled_at = created_at WHERE status = 'fulfilled' AND fulfilled_at IS NULL
    `);
    // Seed apc_test_mode default if not already present
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('apc_test_mode', 'false', NOW())
      ON CONFLICT (key) DO NOTHING
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS postcode_validations (
        id SERIAL PRIMARY KEY,
        shopify_order_id BIGINT NOT NULL,
        postcode TEXT NOT NULL,
        service_code TEXT NOT NULL,
        available BOOLEAN NOT NULL,
        reason TEXT,
        checked_at TIMESTAMP NOT NULL DEFAULT NOW(),
        dispatch_tag TEXT,
        UNIQUE(shopify_order_id, service_code)
      )
    `);
    await db.execute(sql`
      ALTER TABLE recipes ADD COLUMN IF NOT EXISTS is_current_special BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS oven_events (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
        recipe_id INTEGER,
        recipe_name TEXT,
        ingredient_id INTEGER,
        ingredient_name TEXT,
        tray_index INTEGER NOT NULL,
        oven_in_at TIMESTAMP NOT NULL DEFAULT NOW(),
        oven_out_at TIMESTAMP,
        user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        user_name TEXT
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS recipes_one_current_special
      ON recipes (is_current_special)
      WHERE is_current_special = TRUE
    `);
    await db.execute(sql`
      ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS extra_packs_built INTEGER NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS surplus_percent NUMERIC(5,2) NOT NULL DEFAULT 10
    `);
    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER
    `);
    await db.execute(sql`
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS order_frequency TEXT NOT NULL DEFAULT 'daily'
    `);
    await db.execute(sql`
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS order_days TEXT
    `);
    await db.execute(sql`
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS lead_time_days INTEGER NOT NULL DEFAULT 1
    `);
    await db.execute(sql`
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cutoff_time TEXT NOT NULL DEFAULT '17:00'
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS storage_locations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        zone TEXT NOT NULL DEFAULT 'fridge',
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS storage_racks (
        id SERIAL PRIMARY KEY,
        location_id INTEGER NOT NULL REFERENCES storage_locations(id) ON DELETE CASCADE,
        label TEXT NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ingredient_storage_locations (
        id SERIAL PRIMARY KEY,
        ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
        location_id INTEGER NOT NULL REFERENCES storage_locations(id) ON DELETE CASCADE,
        rack_label TEXT,
        shelf_label TEXT
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS stock_transfers (
        id SERIAL PRIMARY KEY,
        ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
        from_location TEXT NOT NULL,
        to_location TEXT NOT NULL,
        quantity NUMERIC(10,4) NOT NULL,
        unit TEXT NOT NULL,
        transferred_at TIMESTAMP NOT NULL DEFAULT NOW(),
        user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        notes TEXT
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id SERIAL PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        plan_id INTEGER REFERENCES production_plans(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        placed_at TIMESTAMP,
        expected_delivery_date DATE,
        notes TEXT,
        placed_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS purchase_order_lines (
        id SERIAL PRIMARY KEY,
        purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
        quantity_required NUMERIC(10,4) NOT NULL DEFAULT 0,
        quantity_ordered NUMERIC(10,4) NOT NULL DEFAULT 0,
        quantity_received NUMERIC(10,4) NOT NULL DEFAULT 0,
        unit TEXT NOT NULL,
        unit_price NUMERIC(10,4),
        checked_off BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS delivery_records (
        id SERIAL PRIMARY KEY,
        purchase_order_id INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        received_at TIMESTAMP NOT NULL DEFAULT NOW(),
        received_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        chilled_temp_c NUMERIC(5,1),
        frozen_temp_c NUMERIC(5,1),
        invoice_filed BOOLEAN NOT NULL DEFAULT FALSE,
        all_put_away BOOLEAN NOT NULL DEFAULT FALSE,
        kanbans_replaced BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS delivery_check_configs (
        id SERIAL PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        is_required BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS delivery_check_results (
        id SERIAL PRIMARY KEY,
        delivery_record_id INTEGER NOT NULL REFERENCES delivery_records(id) ON DELETE CASCADE,
        check_config_id INTEGER NOT NULL REFERENCES delivery_check_configs(id) ON DELETE CASCADE,
        passed BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS kanban_items (
        id SERIAL PRIMARY KEY,
        ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'active',
        pulled_at TIMESTAMP,
        pulled_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        order_day_target DATE,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS dpt_ingredient_requirements (
        id SERIAL PRIMARY KEY,
        ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
        daily_qty_raw NUMERIC(10,4) NOT NULL DEFAULT 0,
        daily_qty_cooked NUMERIC(10,4) NOT NULL DEFAULT 0,
        unit TEXT NOT NULL,
        calculated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS stock_items (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        unit TEXT NOT NULL,
        pack_weight NUMERIC(10,4) NOT NULL DEFAULT 0,
        cost_per_pack NUMERIC(10,4) NOT NULL DEFAULT 0,
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        secondary_supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        supplier_part_number TEXT,
        ordering_url TEXT,
        stock_check_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        stock_check_frequency TEXT NOT NULL DEFAULT 'daily',
        stock_check_day TEXT,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      ALTER TABLE stock_entries ADD COLUMN IF NOT EXISTS stock_item_id INTEGER REFERENCES stock_items(id) ON DELETE SET NULL
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS stock_item_categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      INSERT INTO stock_item_categories (name) VALUES ('Packaging'), ('Cleaning Materials'), ('Chemicals')
      ON CONFLICT (name) DO NOTHING
    `);
    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS kanban_enabled BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS kanban_quantity NUMERIC(10,4) NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS kanban_unit TEXT NOT NULL DEFAULT 'weight'
    `);
    await db.execute(sql`
      ALTER TABLE stock_entries ADD COLUMN IF NOT EXISTS use_by_date DATE
    `);
    await db.execute(sql`
      ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS use_by_date DATE
    `);
    await db.execute(sql`
      ALTER TABLE sub_recipes ADD COLUMN IF NOT EXISTS is_base BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      DELETE FROM prep_completions WHERE recipe_id IS NULL
    `);
    await db.execute(sql`
      ALTER TABLE prep_completions ALTER COLUMN recipe_id SET NOT NULL
    `);
    await db.execute(sql`
      DROP INDEX IF EXISTS uq_prep_completion_v2
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_prep_completion_v3
      ON prep_completions (plan_id, ingredient_id, recipe_id, tin_number)
    `);
    // PIN login & avatar support (Task #36)
    await db.execute(sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS pin_hash TEXT`);
    await db.execute(sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS pin_attempts INTEGER NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMP`);
    await db.execute(sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar_url TEXT`);
    // Shopify inventory sync — recipe→variant mapping (Task #37)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS recipe_shopify_mappings (
        id SERIAL PRIMARY KEY,
        recipe_id INTEGER NOT NULL UNIQUE REFERENCES recipes(id) ON DELETE CASCADE,
        shopify_variant_id TEXT NOT NULL,
        shopify_product_title TEXT,
        shopify_variant_title TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // Founder custom tag panels (added for custom panel feature)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS founder_custom_panels (
        id SERIAL PRIMARY KEY,
        tag TEXT NOT NULL,
        label TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await seedStorageLocations();
    console.log("Startup migrations OK");
  } catch (err) {
    console.error("Startup migration failed (non-fatal):", err);
  }
}

async function seedAdminIfNeeded() {
  try {
    const [{ value }] = await db.select({ value: count() }).from(usersTable);
    console.log(`Seed check: ${value} user(s) in database`);
    if (Number(value) === 0) {
      const tempPassword = "TCKAdmin2024!";
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      await db.insert(usersTable).values({
        name: "Admin",
        email: "admin@thecalzonekitchen.co.uk",
        passwordHash,
        role: "admin",
        isActive: true,
      });
      console.log("===========================================");
      console.log("No users found. Created default admin:");
      console.log("  Email:    admin@thecalzonekitchen.co.uk");
      console.log(`  Password: ${tempPassword}`);
      console.log("Change this password immediately after login.");
      console.log("===========================================");
    }
  } catch (err) {
    console.error("Seed check failed (non-fatal):", err);
  }
}

async function startup() {
  // Listen immediately so the deployment health-check can pass quickly,
  // then run migrations and seeding in the background.
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });

  try {
    await runStartupMigrations();
    await seedAdminIfNeeded();
    startBackupScheduler();
  } catch (err) {
    console.error(
      "Background startup tasks failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

startup();
