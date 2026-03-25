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
 * The generated file:
 *   1. TRUNCATEs all seed tables with CASCADE (clears referencing non-seed tables too)
 *   2. INSERTs data in FK-safe forward order using explicit IDs
 *   3. Resets every serial sequence to max(id) + 1
 *
 * WARNING: Intended for a freshly-provisioned production database.
 * TRUNCATE … CASCADE also clears dependent tables such as production_plan_items,
 * prep_completions, batch_completions, etc.
 */

import { pool } from "@workspace/db";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, "prod-seed.sql");

// ── Seed tables (reverse FK order — most-dependent first) ───────────────────
// Listed this way so TRUNCATE CASCADE can be applied as a single statement.
// Dependent non-seed tables (production_plan_items, etc.) are handled by CASCADE.
const SEED_TABLES_REVERSE: string[] = [
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
];

// Tables with a serial integer PK named "id" — need explicit sequence resets
// after INSERT (because TRUNCATE with explicit-ID INSERTs leaves sequences stale).
const SERIAL_ID_TABLES: string[] = [
  "suppliers",
  "storage_locations",
  "stock_item_categories",   // id SERIAL, name TEXT UNIQUE
  "category_defaults",
  "timing_standards",
  "app_settings",            // id SERIAL, key TEXT UNIQUE
  "ingredients",
  "sub_recipes",
  "recipes",
  "storage_racks",
  "stock_items",
  "recipe_ingredients",
  "recipe_sub_recipes",
  "recipe_meat_marinades",
  "recipe_shopify_mappings",
  "sub_recipe_ingredients",
  "sub_recipe_sub_recipes",
  "dpt_settings",
  "delivery_check_configs",
  "kanban_items",
  "ingredient_storage_locations",
  "postcode_validations",
  // page_permissions  — text PK (page_key), no serial id
  // sku_locations     — text PK (sku),       no serial id
];

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const lines: string[] = [
    "-- ============================================================",
    "-- TCK Production Seed",
    `-- Generated: ${new Date().toISOString()}`,
    "--",
    "-- !! WARNING: For a FRESHLY-PROVISIONED production database only !!",
    "-- TRUNCATE … CASCADE also clears dependent tables:",
    "-- production_plan_items, prep_completions, batch_completions,",
    "-- daily_stock_checks, temperature_records, oven_events, etc.",
    "-- Do NOT run against a database with live operational data.",
    "--",
    "-- Apply via psql:",
    '--   psql "$PRODUCTION_DATABASE_URL" < prod-seed.sql',
    "--",
    "-- Or POST to /api/admin/apply-seed (see MIGRATION.md).",
    "-- ============================================================",
    "",
    "-- ── Step 1: clear seed tables (CASCADE wipes dependent tables) ──",
    "TRUNCATE TABLE",
    "  " + SEED_TABLES_REVERSE.join(",\n  "),
    "CASCADE;",
    "",
  ];

  // ── Step 2: INSERT in FK-safe forward order ────────────────────────────────
  lines.push("-- ── Step 2: insert seed data (FK-safe order) ──────────────────");
  lines.push("");

  const insertOrder: Array<[string, string]> = [
    ["suppliers",                    "id"],
    ["storage_locations",            "id"],
    ["stock_item_categories",        "name"],
    ["category_defaults",            "id"],
    ["timing_standards",             "id"],
    ["app_settings",                 "key"],
    ["page_permissions",             "page_key"],
    ["postcode_validations",         "shopify_order_id, service_code"],
    ["sku_locations",                "sku"],
    // Depend on suppliers
    ["ingredients",                  "id"],
    ["stock_items",                  "id"],
    ["delivery_check_configs",       "id"],
    // No FK in table itself
    ["sub_recipes",                  "id"],
    ["recipes",                      "id"],
    // Depends on storage_locations
    ["storage_racks",                "id"],
    // Junction / child tables
    ["recipe_ingredients",           "id"],
    ["recipe_sub_recipes",           "id"],
    ["recipe_meat_marinades",        "id"],
    ["recipe_shopify_mappings",      "id"],
    ["sub_recipe_ingredients",       "id"],
    ["sub_recipe_sub_recipes",       "id"],
    ["dpt_settings",                 "id"],
    ["kanban_items",                 "id"],
    // ingredient_storage_locations has no quantity/amount columns
    // (id, ingredient_id, location_id, rack_label, shelf_label — copied as-is)
    ["ingredient_storage_locations", "id"],
  ];

  for (const [tableName, orderBy] of insertOrder) {
    console.log(`  Exporting ${tableName}...`);
    const rows = await queryTable(tableName, orderBy);
    lines.push(`-- TABLE: ${tableName} (${rows.length} rows)`);
    lines.push(buildInsert(tableName, rows));
    lines.push("");
  }

  // ── Step 3: reset sequences to max(id) + 1 ────────────────────────────────
  lines.push("-- ── Step 3: reset sequences to max(id) + 1 ────────────────────");
  for (const tbl of SERIAL_ID_TABLES) {
    lines.push(
      `SELECT setval(pg_get_serial_sequence('${tbl}', 'id'),` +
      ` COALESCE((SELECT MAX(id) FROM ${tbl}), 0) + 1, false);`,
    );
  }
  lines.push("");

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
