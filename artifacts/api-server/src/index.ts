import app from "./app";
import { db, usersTable } from "@workspace/db";
import { sql, count } from "drizzle-orm";
import bcrypt from "bcryptjs";

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
  await runStartupMigrations();
  await seedAdminIfNeeded();
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

startup();
