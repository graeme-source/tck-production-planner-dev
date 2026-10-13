#!/usr/bin/env tsx
/**
 * merge-review-objectives-into-agreement.ts — one review's AI-made
 * "objectives" back into ONE "What was agreed" list (Graeme, 2026-10-13).
 * Objective H. The rules are in src/lib/merge-review-objectives.ts (tested).
 *
 * Needs migration 0186 (the 'agreement' kind) applied first.
 *
 * Dry run (default — prints what it would do, writes nothing):
 *   cd artifacts/api-server
 *   node --env-file=.env --import tsx/esm scripts/merge-review-objectives-into-agreement.ts --entry 123
 *
 * Choose the notes yourself instead of matching the AI save's time:
 *   … --entry 123 --notes 456,457,458
 *
 * Apply (one transaction: the list is added, the objectives soft-deleted
 * with deleted_at — never hard-deleted — and an audit line written):
 *   … --entry 123 --apply
 *
 * Idempotent: a second run finds nothing left to merge.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db, pool, peopleReviewNotesTable, peopleRecordEntriesTable, peopleRecordEntrySourcesTable, peopleRecordAuditTable,
} from "@workspace/db";
import { planMergeIntoAgreement } from "../src/lib/merge-review-objectives";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  const entryId = Number(arg("--entry"));
  if (!Number.isInteger(entryId) || entryId <= 0) throw new Error("Usage: --entry <id> [--notes id,id,…] [--dry-run | --apply]");
  const apply = process.argv.includes("--apply");
  const notesArg = arg("--notes");
  const noteIds = notesArg ? notesArg.split(",").map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0) : null;

  const [entry] = await db.select({ id: peopleRecordEntriesTable.id, userId: peopleRecordEntriesTable.userId })
    .from(peopleRecordEntriesTable).where(eq(peopleRecordEntriesTable.id, entryId));
  if (!entry) throw new Error(`No entry ${entryId}`);

  const [notes, sources] = await Promise.all([
    db.select().from(peopleReviewNotesTable).where(eq(peopleReviewNotesTable.entryId, entryId)),
    db.select({ createdAt: peopleRecordEntrySourcesTable.createdAt }).from(peopleRecordEntrySourcesTable)
      .where(eq(peopleRecordEntrySourcesTable.entryId, entryId)),
  ]);

  const plan = planMergeIntoAgreement({ entryId, notes, sourceTimes: sources.map(s => s.createdAt), noteIds });
  if (!plan.ok) { console.error(`Not merged: ${plan.error}`); process.exitCode = 1; return; }
  if (plan.nothing) { console.log(plan.message); return; }

  console.log(`Entry ${entryId}: ${plan.mergeIds.length} objective(s) → one "What was agreed" list${plan.appendTo ? ` (added to existing #${plan.appendTo.id})` : ""}`);
  for (const b of plan.bullets) console.log(`  • ${b}`);
  for (const w of plan.warnings) console.log(`  ! ${w}`);
  console.log(`  Objectives to soft-delete: ${plan.mergeIds.map(id => `#${id}`).join(", ")}`);
  if (!apply) { console.log("\nDry run — nothing written. Add --apply to do it."); return; }

  const now = new Date();
  await db.transaction(async tx => {
    // Only still-live objectives — a run racing another can't double up.
    const live = await tx.update(peopleReviewNotesTable)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(inArray(peopleReviewNotesTable.id, plan.mergeIds), isNull(peopleReviewNotesTable.deletedAt)))
      .returning({ id: peopleReviewNotesTable.id });
    if (live.length !== plan.mergeIds.length) throw new Error("Some of those notes changed since the plan — run it again.");
    let listId: number;
    if (plan.appendTo) {
      await tx.update(peopleReviewNotesTable).set({ body: plan.appendTo.body, updatedAt: now })
        .where(eq(peopleReviewNotesTable.id, plan.appendTo.id));
      listId = plan.appendTo.id;
    } else {
      const [row] = await tx.insert(peopleReviewNotesTable).values({ ...plan.insert!, updatedAt: now })
        .returning({ id: peopleReviewNotesTable.id });
      listId = row!.id;
    }
    await tx.insert(peopleRecordAuditTable).values({
      viewerId: null, viewerName: "Merge script (objectives → What was agreed)", subjectUserId: entry.userId,
      entryId, action: "write_up_merge", detail: `${plan.auditDetail} → #${listId}`.slice(0, 500),
    });
    console.log(`\nApplied: list #${listId}; ${live.length} objective(s) soft-deleted; audit line written.`);
  });
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
