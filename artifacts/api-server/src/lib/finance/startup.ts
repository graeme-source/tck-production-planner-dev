import { db, finLinesTable, finVendorsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { BACKLOG_ROWS, backlogDedupeHash } from "./backlog-seed";
import { normaliseMerchant } from "./merchant-normalise";
import { runMailboxSync } from "./mailbox-sync";

// Finance startup: one-time backlog seed + the hourly mailbox sync timer.
// Seed is guarded by a _migrations_done key (the codebase's standard
// run-once pattern) so later edits to seeded lines are never overwritten.

export async function seedFinanceBacklogIfNeeded(): Promise<void> {
  const done = await db.execute(sql`SELECT key FROM _migrations_done WHERE key = 'finance_backlog_seed_v1'`);
  if ((done as any).rows?.length > 0) return;

  for (let i = 0; i < BACKLOG_ROWS.length; i++) {
    const row = BACKLOG_ROWS[i];
    const normalised = normaliseMerchant(row.supplier);
    let vendorId: number | null = null;
    if (normalised) {
      const [existing] = await db
        .select({ id: finVendorsTable.id })
        .from(finVendorsTable)
        .where(eq(finVendorsTable.normalisedName, normalised));
      if (existing) vendorId = existing.id;
      else {
        const [created] = await db
          .insert(finVendorsTable)
          .values({ name: row.supplier, normalisedName: normalised })
          .onConflictDoNothing({ target: finVendorsTable.normalisedName })
          .returning({ id: finVendorsTable.id });
        vendorId = created?.id ?? null;
      }
    }
    const isCard = /^\d{4}$/.test(row.ref);
    await db
      .insert(finLinesTable)
      .values({
        source: "backlog_seed",
        lineDate: row.date,
        descriptor: row.supplier,
        merchant: row.supplier,
        amount: row.value,
        cardLast4: isCard ? row.ref : null,
        cardholder: row.teamMember,
        vendorId,
        status: "open",
        statusNote: row.note || null,
        dedupeHash: backlogDedupeHash(row, i),
      })
      .onConflictDoNothing({ target: finLinesTable.dedupeHash });
  }

  await db.execute(sql`INSERT INTO _migrations_done (key) VALUES ('finance_backlog_seed_v1')`);
  console.log(`[finance] Seeded ${BACKLOG_ROWS.length} backlog lines from the Outstanding Transactions sheet`);
}

/** Hourly mailbox sync. Self-gates: a no-op until a mailbox is configured. */
export function startFinanceMailboxTimer(): void {
  const run = () =>
    runMailboxSync()
      .then((o) => {
        if (o.error && o.error !== "No mailbox configured" && o.error !== "Sync already running") {
          console.error("[finance] mailbox sync:", o.error);
        } else if (o.indexed > 0 || o.suggestionsRefreshed > 0) {
          console.log(`[finance] mailbox sync: scanned ${o.scanned}, indexed ${o.indexed}, suggestions for ${o.suggestionsRefreshed} lines`);
        }
      })
      .catch((e) => console.error("[finance] mailbox sync failed:", e));
  // First run shortly after boot (let migrations settle), then hourly.
  setTimeout(run, 30_000).unref();
  setInterval(run, 60 * 60_000).unref();
}
