import { db, finLinesTable, finMatchesTable, finVendorsTable } from "@workspace/db";
import { and, eq, isNotNull, isNull, like, sql } from "drizzle-orm";
import { BACKLOG_ROWS, backlogDedupeHash } from "./backlog-seed";
import { SHEET_ROWS_2026_11, sheetRowNote, sheetRowPosted, sheetRowDedupeHash, sheetNotesByDedupeHash } from "./backlog-reset-2026-11";
import { normaliseMerchant } from "./merchant-normalise";
import { runMailboxSync, refreshSuggestions } from "./mailbox-sync";
import { runQboSync } from "./qbo";

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

/** One-time reset (Graeme, 3 Nov 2026): clear every line on Outstanding
 *  Transactions (old test entries) and load the current sheet instead.
 *  Matches are derived, so they go too and are rebuilt afterwards. Attached
 *  documents are KEPT in fin_documents (6-year retention): they simply no
 *  longer show against any line. All in one transaction, run once. */
export async function resetFinanceBacklogIfNeeded(): Promise<void> {
  const KEY = "finance_backlog_reset_2026_11_03";
  const done = await db.execute(sql`SELECT key FROM _migrations_done WHERE key = ${KEY}`);
  if ((done as any).rows?.length > 0) return;

  const removed = await db.transaction(async (tx) => {
    await tx.delete(finMatchesTable);
    const gone = await tx.delete(finLinesTable).returning({ id: finLinesTable.id });
    for (let i = 0; i < SHEET_ROWS_2026_11.length; i++) {
      const row = SHEET_ROWS_2026_11[i];
      const normalised = normaliseMerchant(row.supplier);
      let vendorId: number | null = null;
      if (normalised) {
        const [existing] = await tx.select({ id: finVendorsTable.id }).from(finVendorsTable)
          .where(eq(finVendorsTable.normalisedName, normalised));
        if (existing) vendorId = existing.id;
        else {
          const [created] = await tx.insert(finVendorsTable)
            .values({ name: row.supplier, normalisedName: normalised })
            .onConflictDoNothing({ target: finVendorsTable.normalisedName })
            .returning({ id: finVendorsTable.id });
          vendorId = created?.id ?? null;
        }
      }
      await tx.insert(finLinesTable).values({
        source: "backlog_seed",
        lineDate: row.date,
        descriptor: row.supplier,
        merchant: row.supplier,
        amount: row.value,
        cardLast4: /^\d{4}$/.test(row.ref) ? row.ref : null,
        cardholder: row.teamMember,
        vendorId,
        status: "open",
        statusNote: sheetRowNote(row),
        postedDetectedAt: sheetRowPosted(row) ? new Date() : null,
        dedupeHash: sheetRowDedupeHash(row, i),
      });
    }
    await tx.execute(sql`INSERT INTO _migrations_done (key) VALUES (${KEY})`);
    return gone.length;
  });
  console.log(`[finance] Outstanding Transactions reset: removed ${removed} old lines, loaded ${SHEET_ROWS_2026_11.length} from the 3 Nov sheet`);
  refreshSuggestions().catch((e) => console.error("[finance] suggestion refresh after reset failed:", e));
}

/** One-time fix (Graeme, 3 Nov 2026): the QuickBooks sync used to close
 *  lines it found posted, and closed 19 of the freshly loaded sheet lines
 *  minutes after the reset. Posted no longer closes a line, so reopen every
 *  line the sync closed (done, QuickBooks-linked, no person marked it done,
 *  sync's note) and put the sheet note back. The Posted tick and the
 *  QuickBooks link stay. Run once. */
export async function reopenQboClosedLinesIfNeeded(): Promise<void> {
  const KEY = "finance_reopen_qbo_closed_2026_11_03";
  const done = await db.execute(sql`SELECT key FROM _migrations_done WHERE key = ${KEY}`);
  if ((done as any).rows?.length > 0) return;

  const notes = sheetNotesByDedupeHash();
  const reopened = await db.transaction(async (tx) => {
    const closed = await tx.select({ id: finLinesTable.id, dedupeHash: finLinesTable.dedupeHash })
      .from(finLinesTable)
      .where(and(
        eq(finLinesTable.status, "done"),
        isNotNull(finLinesTable.qboTxnId),
        isNull(finLinesTable.doneBy),
        like(finLinesTable.statusNote, "Posted in QuickBooks (%"),
      ));
    for (const line of closed) {
      await tx.update(finLinesTable).set({
        status: "open",
        statusNote: notes.has(line.dedupeHash) ? notes.get(line.dedupeHash)! : "Posted in QuickBooks — still needs invoice",
        doneAt: null,
        updatedAt: new Date(),
      }).where(eq(finLinesTable.id, line.id));
    }
    await tx.execute(sql`INSERT INTO _migrations_done (key) VALUES (${KEY})`);
    return closed.length;
  });
  console.log(`[finance] Reopened ${reopened} lines the QuickBooks sync had closed (posted no longer closes a line)`);
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
  const runQbo = () =>
    runQboSync()
      .then((o) => {
        if (o.error && o.error !== "QuickBooks is not connected" && o.error !== "Sync already running") {
          console.error("[finance] QBO sync:", o.error);
        } else if (o.purchases + o.bills > 0 || o.linesMarkedPosted > 0) {
          console.log(`[finance] QBO sync: ${o.purchases} purchases, ${o.bills} bills, ${o.linesMarkedPosted} lines marked posted`);
        }
      })
      .catch((e) => console.error("[finance] QBO sync failed:", e));
  // First run shortly after boot (let migrations settle), then hourly.
  setTimeout(run, 30_000).unref();
  setInterval(run, 60 * 60_000).unref();
  setTimeout(runQbo, 45_000).unref();
  setInterval(runQbo, 60 * 60_000).unref();
}
