import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, finDocumentsTable, finEventsTable, finInvoicesTable, finLinesTable, finMatchesTable, finQboConnectionTable, finStatementUploadsTable, finVendorsTable } from "@workspace/db";
import { logFinEvent } from "./invoice-store";
import { invoiceIdFromRef, whyKeepLine } from "./upload-undo-plan";

// Undo a statement upload (Graeme, 4 Nov 2026: the Capital on Tap upload and
// the library match made a mess of Outstanding). Back to how it was: the
// upload's transactions go with their automatic matches, and library invoices
// leave the queue. Automatic matches on other transactions (the original
// spreadsheet ones) stay unless asked for: those are what he'd knocked off.
// Anything a person worked on stays, and is listed. The preview and the undo
// share one plan, so what's shown is what happens.

const DROPPED_ON_OUTSTANDING = "outstanding_find_transaction";

export async function recentUploads() {
  return db.select({
    id: finStatementUploadsTable.id, fileName: finStatementUploadsTable.fileName, source: finStatementUploadsTable.source,
    rowCount: finStatementUploadsTable.rowCount, newCount: finStatementUploadsTable.newCount, createdAt: finStatementUploadsTable.createdAt,
    linesLeft: sql<number>`(SELECT count(*)::int FROM fin_lines l WHERE l.upload_id = fin_statement_uploads.id)`,
  }).from(finStatementUploadsTable).orderBy(desc(finStatementUploadsTable.createdAt)).limit(10);
}

/** Invoices someone dropped on Outstanding: they stay in the queue. */
async function droppedInvoiceIds(): Promise<Set<number>> {
  const rows = await db.select({ id: finEventsTable.entityId }).from(finEventsTable).where(and(
    eq(finEventsTable.entityType, "invoice"),
    eq(finEventsTable.action, "uploaded"),
    sql`${finEventsTable.detail}->>'via' = ${DROPPED_ON_OUTSTANDING}`,
  ));
  return new Set(rows.map((r) => r.id));
}

async function planUndo(uploadId: number, alsoOtherMatches = false) {
  const lines = await db.select({
    id: finLinesTable.id, lineDate: finLinesTable.lineDate, descriptor: finLinesTable.descriptor, merchant: finLinesTable.merchant,
    amount: finLinesTable.amount, noVatReason: finLinesTable.noVatReason, statusNote: finLinesTable.statusNote,
    postedDetectedAt: finLinesTable.postedDetectedAt, vendorName: finVendorsTable.name,
  }).from(finLinesTable).leftJoin(finVendorsTable, eq(finVendorsTable.id, finLinesTable.vendorId)).where(eq(finLinesTable.uploadId, uploadId));
  const ids = lines.map((l) => l.id);
  const docs = ids.length ? await db.select({ lineId: finDocumentsTable.lineId, docSource: finDocumentsTable.docSource }).from(finDocumentsTable).where(inArray(finDocumentsTable.lineId, ids)) : [];
  const events = ids.length ? await db.select({ id: finEventsTable.entityId, action: finEventsTable.action }).from(finEventsTable)
    .where(and(eq(finEventsTable.entityType, "line"), inArray(finEventsTable.entityId, ids))) : [];

  const remove: typeof lines = [];
  const keep: Array<{ id: number; supplier: string; date: string; amount: string; reason: string }> = [];
  for (const l of lines) {
    const reason = whyKeepLine({
      noVatReason: l.noVatReason, statusNote: l.statusNote,
      actions: events.filter((e) => e.id === l.id).map((e) => e.action),
      documentSources: docs.filter((d) => d.lineId === l.id).map((d) => d.docSource),
    });
    if (reason) keep.push({ id: l.id, supplier: l.vendorName ?? l.merchant ?? l.descriptor, date: l.lineDate, amount: l.amount, reason });
    else remove.push(l);
  }

  const everyAutomaticMatch = await db.select({ id: finDocumentsTable.id, lineId: finDocumentsTable.lineId, sourceRef: finDocumentsTable.sourceRef })
    .from(finDocumentsTable).where(eq(finDocumentsTable.docSource, "auto_match"));
  const onThisUpload = new Set(ids);
  const otherMatches = everyAutomaticMatch.filter((d) => !onThisUpload.has(d.lineId));
  const automaticMatches = everyAutomaticMatch.filter((d) => alsoOtherMatches || onThisUpload.has(d.lineId));
  const dropped = await droppedInvoiceIds();
  const queued = await db.select({ id: finInvoicesTable.id }).from(finInvoicesTable)
    .where(and(isNotNull(finInvoicesTable.awaitingTransactionAt), isNull(finInvoicesTable.lineId)));
  const libraryQueued = queued.filter((q) => !dropped.has(q.id)).map((q) => q.id);
  const [qbo] = await db.select({ account: finQboConnectionTable.autoImportAccount }).from(finQboConnectionTable).limit(1);
  return { lines, remove, keep, automaticMatches, otherMatches, libraryQueued, dropped, quickBooksImportOn: !!qbo?.account };
}

export async function previewUploadUndo(uploadId: number) {
  const [upload] = await db.select().from(finStatementUploadsTable).where(eq(finStatementUploadsTable.id, uploadId));
  if (!upload) return null;
  const p = await planUndo(uploadId);
  return {
    upload: { id: upload.id, fileName: upload.fileName, createdAt: upload.createdAt },
    removing: p.remove.length,
    removingValue: p.remove.reduce((t, l) => t + Number(l.amount), 0).toFixed(2),
    postedAmongThem: p.remove.filter((l) => l.postedDetectedAt).length,
    keeping: p.keep,
    automaticMatches: p.automaticMatches.length,
    otherAutomaticMatches: p.otherMatches.length,
    libraryQueued: p.libraryQueued.length,
    quickBooksImportOn: p.quickBooksImportOn,
  };
}

export async function undoUpload(uploadId: number, userId: number | null, alsoOtherMatches = false) {
  const p = await planUndo(uploadId, alsoOtherMatches);
  const removeIds = p.remove.map((l) => l.id);
  const invoiceIds = p.automaticMatches.flatMap((d) => invoiceIdFromRef(d.sourceRef) ?? []);

  await db.transaction(async (tx) => {
    if (p.automaticMatches.length) {
      await tx.delete(finDocumentsTable).where(inArray(finDocumentsTable.id, p.automaticMatches.map((d) => d.id)));
      for (const lineId of new Set(p.automaticMatches.map((d) => d.lineId))) {
        const [left] = await tx.select({ id: finDocumentsTable.id }).from(finDocumentsTable).where(eq(finDocumentsTable.lineId, lineId)).limit(1);
        await tx.update(finLinesTable).set({ status: left ? "matched" : "open", doneAt: null, doneBy: null, updatedAt: new Date() })
          .where(and(eq(finLinesTable.id, lineId), inArray(finLinesTable.status, ["identified", "matched", "done"])));
      }
    }
    for (const id of invoiceIds) {
      await tx.update(finInvoicesTable).set({
        lineId: null, documentId: null, postedBy: null, postedAt: null,
        awaitingTransactionAt: p.dropped.has(id) ? new Date() : null, updatedAt: new Date(),
      }).where(eq(finInvoicesTable.id, id));
    }
    if (p.libraryQueued.length) {
      await tx.update(finInvoicesTable).set({ awaitingTransactionAt: null, updatedAt: new Date() }).where(inArray(finInvoicesTable.id, p.libraryQueued));
    }
    if (removeIds.length) {
      await tx.update(finInvoicesTable).set({ lineId: null, documentId: null, updatedAt: new Date() }).where(inArray(finInvoicesTable.lineId, removeIds));
      await tx.delete(finMatchesTable).where(inArray(finMatchesTable.lineId, removeIds));
      await tx.delete(finLinesTable).where(inArray(finLinesTable.id, removeIds));
    }
  });

  // The record of what went, so it can be seen or put back by hand.
  await logFinEvent("upload", uploadId, "upload_undone", userId, {
    removed: p.remove, kept: p.keep, automaticMatchesRemoved: invoiceIds, libraryInvoicesUnqueued: p.libraryQueued,
  });
  return { removed: removeIds.length, kept: p.keep.length, automaticMatches: p.automaticMatches.length, libraryQueued: p.libraryQueued.length };
}
