#!/usr/bin/env tsx
/**
 * export-prod-seed.ts
 *
 * Exports seed/config reference data from the current DATABASE_URL into a SQL
 * file that can be applied to a fresh production database.
 *
 * Run:
 *   pnpm --filter @workspace/api-server run export-seed
 *
 * Output:
 *   artifacts/api-server/scripts/prod-seed.sql
 *
 * WARNING: The generated file uses TRUNCATE … CASCADE which is intended for a
 * freshly-provisioned production database only. Do NOT apply it to a database
 * that already contains production plan, purchase order, or dispatch data.
 */

import { pool } from "@workspace/db";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, "prod-seed.sql");

function sqlLiteral(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  if (val instanceof Date) {
    return `'${val.toISOString().replace("T", " ").replace("Z", "")}'`;
  }
  const s = String(val);
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function buildInsert(tableName: string, rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return `-- ${tableName}: no rows\n`;
  const cols = Object.keys(rows[0]);
  const valueRows = rows
    .map(r => `  (${cols.map(c => sqlLiteral(r[c])).join(", ")})`)
    .join(",\n");
  return `INSERT INTO ${tableName} (${cols.join(", ")}) VALUES\n${valueRows};\n`;
}

async function queryTable(
  tableName: string,
  orderBy: string,
): Promise<Record<string, unknown>[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM ${tableName} ORDER BY ${orderBy}`,
    );
    return result.rows as Record<string, unknown>[];
  } finally {
    client.release();
  }
}

async function main() {
  // ── Tables to truncate in reverse FK order ──────────────────────────────────
  // Listed from most-dependent (leaf) to least-dependent (root) so that
  // a single TRUNCATE statement with RESTART IDENTITY (no CASCADE needed when
  // all seed tables are listed together) respects FK constraints between them.
  const TRUNCATE_REVERSE_ORDER = [
    "ingredient_storage_locations",
    "kanban_items",
    "delivery_check_configs",
    "dpt_settings",
    "sub_recipe_sub_recipes",
    "sub_recipe_ingredients",
    "recipe_shopify_mappings",
    "recipe_meat_marinades",
    "recipe_sub_recipes",
    "recipe_ingredients",
    "stock_items",
    "storage_racks",
    "recipes",
    "sub_recipes",
    "ingredients",
    "sku_locations",
    "postcode_validations",
    "page_permissions",
    "app_settings",
    "timing_standards",
    "category_defaults",
    "stock_item_categories",
    "storage_locations",
    "suppliers",
  ].join(",\n  ");

  const lines: string[] = [
    "-- ============================================================",
    "-- TCK Production Seed",
    `-- Generated: ${new Date().toISOString()}`,
    "--",
    "-- !! WARNING: For a FRESHLY-PROVISIONED production database only !!",
    "-- The TRUNCATE below uses CASCADE, which will also clear any tables",
    "-- that hold foreign-key references to the seed tables (e.g.",
    "-- production_plans, purchase_orders, dispatch_orders).  Do NOT run",
    "-- this against a database that already contains live operational data.",
    "--",
    "-- Apply via psql:",
    "--   psql \"$PRODUCTION_DATABASE_URL\" < prod-seed.sql",
    "--",
    "-- Or apply via the admin API endpoint (see MIGRATION.md).",
    "-- ============================================================",
    "",
  ];

  // ── 1. Truncate all seed tables (CASCADE handles dependent non-seed tables) ─
  lines.push("-- Step 1: clear seed tables and reset sequences");
  lines.push("TRUNCATE TABLE");
  lines.push(`  ${TRUNCATE_REVERSE_ORDER}`);
  lines.push("RESTART IDENTITY CASCADE;");
  lines.push("");

  // ── 2. Insert data in FK-safe forward order ─────────────────────────────────
  lines.push("-- Step 2: insert seed data (FK-safe order)");
  lines.push("");

  const dump = async (tableName: string, orderBy: string) => {
    console.log(`  Exporting ${tableName}...`);
    const rows = await queryTable(tableName, orderBy);
    lines.push(`-- TABLE: ${tableName} (${rows.length} rows)`);
    lines.push(buildInsert(tableName, rows));
    lines.push("");
  };

  // No FK deps
  await dump("suppliers",             "id");
  await dump("storage_locations",     "id");
  await dump("stock_item_categories", "name");
  await dump("category_defaults",     "id");
  await dump("timing_standards",      "id");
  await dump("app_settings",          "key");
  await dump("page_permissions",      "page_key");
  await dump("postcode_validations",  "shopify_order_id, service_code");
  await dump("sku_locations",         "sku");

  // Depend on suppliers
  await dump("ingredients",           "id");
  await dump("stock_items",           "id");
  await dump("delivery_check_configs","id");

  // No FK in table itself
  await dump("sub_recipes",           "id");
  await dump("recipes",               "id");

  // Depends on storage_locations
  await dump("storage_racks",         "id");

  // Junction / child tables
  await dump("recipe_ingredients",         "id");
  await dump("recipe_sub_recipes",         "id");
  await dump("recipe_meat_marinades",      "id");
  await dump("recipe_shopify_mappings",    "id");
  await dump("sub_recipe_ingredients",     "id");
  await dump("sub_recipe_sub_recipes",     "id");
  await dump("dpt_settings",              "id");
  await dump("kanban_items",              "id");
  await dump("ingredient_storage_locations", "id");

  const content = lines.join("\n");
  writeFileSync(OUTPUT, content, "utf-8");
  console.log(`\nWrote ${OUTPUT}`);
  console.log(`  ${content.split("\n").length} lines, ${content.length} bytes`);

  await pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error(
    "Export failed:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
