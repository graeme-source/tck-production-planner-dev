import pg from "pg";
import fs from "fs";
import path from "path";
import readline from "readline";
import { importKanbans } from "./import-kanbans.js";

const MIGRATION_PATH = path.resolve(
  import.meta.dirname,
  "../../lib/db/migrations/0004_add_kanban_fields_to_stock_items.sql",
);

function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

function isProductionUrl(url: string): boolean {
  return !url.includes("localhost") && !url.includes("127.0.0.1") && !url.includes("helium");
}

async function runMigration(databaseUrl: string) {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(sql);
    console.log("Migration applied successfully.");
  } finally {
    await client.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isProduction = args.includes("--production");
  const skipMigration = args.includes("--skip-migration");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL environment variable is required");
    process.exit(1);
  }

  const looksLikeProduction = isProductionUrl(databaseUrl);

  if (looksLikeProduction && !isProduction) {
    console.error("ERROR: DATABASE_URL appears to be a production database but --production flag was not provided.");
    console.error("If this is intentional, re-run with --production flag.");
    process.exit(1);
  }

  if (isProduction && !looksLikeProduction) {
    console.warn("WARNING: --production flag set but DATABASE_URL looks like a local/dev database.");
    console.warn(`URL: ${databaseUrl.replace(/:[^:@]+@/, ":***@")}`);
  }

  if (isProduction) {
    console.log("\n*** PRODUCTION MODE ***");
    console.log(`Database: ${databaseUrl.replace(/:[^:@]+@/, ":***@")}`);
    console.log("This will modify the production database.\n");

    const preConfirm = await askConfirmation(
      "Are you sure you want to target the PRODUCTION database? (y/N): ",
    );
    if (!preConfirm) {
      console.log("Aborted.");
      process.exit(0);
    }
  } else {
    console.log("Running against development database.");
    console.log(`Database: ${databaseUrl.replace(/:[^:@]+@/, ":***@")}\n`);
  }

  if (!skipMigration) {
    console.log("Step 1: Running migration (add kanban fields to stock_items)...");
    await runMigration(databaseUrl);
  } else {
    console.log("Step 1: Migration skipped (--skip-migration flag).");
  }

  console.log("\nStep 2: Running import in DRY-RUN mode...");
  const report = await importKanbans(databaseUrl, false);

  console.log("\n" + "=".repeat(70));
  console.log("  DRY-RUN REPORT");
  console.log("=".repeat(70));
  console.log(`  Suppliers to create:   ${report.suppliersCreated.length}`);
  for (const s of report.suppliersCreated) console.log(`    + ${s}`);
  console.log(`  Categories to create:  ${report.categoriesCreated.length}`);
  for (const c of report.categoriesCreated) console.log(`    + ${c}`);
  console.log(`  Ingredients matched:   ${report.ingredientsMatched.length}`);
  for (const i of report.ingredientsMatched) {
    console.log(`    = ${i.name} [${i.matchType}] ${i.kanbanSet ? "(kanban SET)" : "(already has kanban, SKIP)"}`);
  }
  console.log(`  Ingredients to create: ${report.ingredientsCreated.length}`);
  for (const n of report.ingredientsCreated) console.log(`    + ${n}`);
  console.log(`  Stock items to create: ${report.stockItemsCreated.length}`);
  for (const n of report.stockItemsCreated) console.log(`    + ${n}`);
  console.log(`  Skipped rows:          ${report.skippedRows.length}`);
  for (const s of report.skippedRows) console.log(`    - Row #${s.number}: ${s.reason}`);
  console.log(`  Manual review needed:  ${report.manualReview.length}`);
  for (const m of report.manualReview) console.log(`    ? Row #${m.number} "${m.name}": ${m.reason}`);
  console.log("=".repeat(70));

  const commitConfirm = await askConfirmation(
    `\nProceed with COMMIT mode${isProduction ? " on PRODUCTION" : ""}? (y/N): `,
  );
  if (!commitConfirm) {
    console.log("Aborted.");
    process.exit(0);
  }

  console.log("\nStep 3: Running import in COMMIT mode (within transaction)...");
  const commitReport = await importKanbans(databaseUrl, true);

  console.log("\n" + "=".repeat(70));
  console.log("  COMMIT COMPLETE");
  console.log("=".repeat(70));
  console.log(`  Suppliers created:     ${commitReport.suppliersCreated.length}`);
  console.log(`  Categories created:    ${commitReport.categoriesCreated.length}`);
  console.log(`  Ingredients matched:   ${commitReport.ingredientsMatched.length}`);
  console.log(`  Ingredients created:   ${commitReport.ingredientsCreated.length}`);
  console.log(`  Stock items created:   ${commitReport.stockItemsCreated.length}`);
  console.log(`  Skipped:               ${commitReport.skippedRows.length}`);
  console.log(`  Manual review:         ${commitReport.manualReview.length}`);
  console.log("=".repeat(70) + "\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
