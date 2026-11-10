import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, finEventsTable, finInvoicesTable, finInvoiceUploadsTable, usersTable } from "@workspace/db";
import { invoiceSourceText } from "./invoice-source";
import { attachInvoiceToLine, rankForInvoice, waitingLines, type InvoiceMatches } from "./invoice-attach";
import { logFinEvent } from "./invoice-store";
import { withGbpRate } from "./fx-rates";
import { isWorthChecking, pickCertainMatches } from "./invoice-to-line";
import { runQboSync } from "./qbo";

// Add an invoice once (Graeme, 4 Nov 2026): one dropped on Outstanding before
// its card transaction exists waits here. When transactions arrive, the
// undeniable ones attach themselves and land under To be processed; anything
// less certain is put to a person.

const QBO_WAIT_MS = 25_000;

const queuedColumns = {
  id: finInvoicesTable.id, fileName: finInvoicesTable.fileName, fileMime: finInvoicesTable.fileMime,
  supplierName: finInvoicesTable.supplierName, invoiceDate: finInvoicesTable.invoiceDate,
  invoiceNumber: finInvoicesTable.invoiceNumber, totalAmount: finInvoicesTable.totalAmount,
  vatAmount: finInvoicesTable.vatAmount, docKind: finInvoicesTable.docKind,
  readStatus: finInvoicesTable.readStatus, readNote: finInvoicesTable.readNote,
  notes: finInvoicesTable.notes, paymentStatus: finInvoicesTable.paymentStatus, currency: finInvoicesTable.currency,
  rejectedLineIds: finInvoicesTable.rejectedLineIds, awaitingTransactionAt: finInvoicesTable.awaitingTransactionAt,
  postedAt: finInvoicesTable.postedAt,
};

/** Everything that can still meet its transaction. One the bookkeeper has
 *  posted stays in here: if its card charge turns up later, it attaches itself
 *  and closes, rather than being chased as a transaction with no invoice. */
async function queuedInvoices() {
  return db.select(queuedColumns).from(finInvoicesTable)
    .where(and(isNotNull(finInvoicesTable.awaitingTransactionAt), isNull(finInvoicesTable.lineId), isNull(finInvoicesTable.duplicateOfId)))
    .orderBy(asc(finInvoicesTable.awaitingTransactionAt));
}

/** Put an invoice dropped on Outstanding in the queue, unless it's attached.
 *  A second copy of an invoice queues the original. */
export async function queueInvoice(id: number): Promise<void> {
  const [inv] = await db.select({ duplicateOfId: finInvoicesTable.duplicateOfId }).from(finInvoicesTable).where(eq(finInvoicesTable.id, id));
  if (!inv) return;
  await db.update(finInvoicesTable).set({ awaitingTransactionAt: new Date(), updatedAt: new Date() })
    .where(and(eq(finInvoicesTable.id, inv.duplicateOfId ?? id), isNull(finInvoicesTable.lineId), isNull(finInvoicesTable.awaitingTransactionAt)));
}

/** The same file added straight onto a transaction: nothing left to wait for. */
async function settleAttachedByHand(): Promise<void> {
  await db.execute(sql`
    UPDATE fin_invoices i
       SET line_id = d.line_id, document_id = d.id, awaiting_transaction_at = NULL, updated_at = NOW()
      FROM fin_documents d
     WHERE i.awaiting_transaction_at IS NOT NULL AND i.line_id IS NULL
       AND d.sha256 = i.sha256 AND d.superseded_by IS NULL
  `);
}

let matching = false;

/** Attach every queued invoice whose transaction is beyond doubt. */
export async function matchQueuedInvoices(userId: number | null = null): Promise<{ matched: number; autoDone: number }> {
  if (matching) return { matched: 0, autoDone: 0 };
  matching = true;
  try {
    await settleAttachedByHand();
    const invoices = await queuedInvoices();
    if (invoices.length === 0) return { matched: 0, autoDone: 0 };
    let matched = 0;
    let autoDone = 0;
    for (const pick of pickCertainMatches(await Promise.all(invoices.map(withGbpRate)), await waitingLines())) {
      const r = await attachInvoiceToLine(pick.invoiceId, pick.lineId, userId, { auto: true, reasons: pick.reasons });
      if (!r.ok) continue;
      matched++;
      if (r.autoDone) autoDone++;
    }
    return { matched, autoDone };
  } finally {
    matching = false;
  }
}

type QueuedRow = Awaited<ReturnType<typeof queuedInvoices>>[number] & { gbpRate: number | null };
export type QueueEntry = { invoice: Omit<QueuedRow, "rejectedLineIds" | "postedAt"> & { sourceText: string } } & InvoiceMatches;

/** "Uploaded by Gillian on the Finance page · 9 Nov, 13:18" per invoice
 *  (Graeme, 10 Nov 2026) — who put it in, and how. */
async function sourceTexts(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  const rows = await db.select({
    id: finInvoicesTable.id, source: finInvoicesTable.source, uploadId: finInvoicesTable.uploadId,
    createdAt: finInvoicesTable.createdAt, uploaderName: usersTable.name, uploadFileName: finInvoiceUploadsTable.fileName,
  }).from(finInvoicesTable)
    .leftJoin(usersTable, eq(usersTable.id, finInvoicesTable.uploadedBy))
    .leftJoin(finInvoiceUploadsTable, eq(finInvoiceUploadsTable.id, finInvoicesTable.uploadId))
    .where(inArray(finInvoicesTable.id, ids));
  const events = await db.select({ entityId: finEventsTable.entityId, detail: finEventsTable.detail }).from(finEventsTable)
    .where(and(eq(finEventsTable.entityType, "invoice"), eq(finEventsTable.action, "uploaded"), inArray(finEventsTable.entityId, ids)));
  const via = new Map<number, string>();
  for (const e of events) if (typeof e.detail?.["via"] === "string") via.set(e.entityId, e.detail["via"] as string);
  for (const r of rows) {
    out.set(r.id, invoiceSourceText({
      source: r.source, uploaderName: r.uploaderName, via: via.get(r.id) ?? null,
      uploadId: r.uploadId, uploadFileName: r.uploadFileName, createdAt: r.createdAt,
    }));
  }
  return out;
}

/** `check` has something likely enough to be worth someone's time
 *  (isWorthChecking), or charges that add up to it; `waiting` has nothing that
 *  good yet. A shared supplier alone isn't worth interrupting anyone: it
 *  describes every invoice from a regular. */
export async function invoiceQueue(): Promise<{ check: QueueEntry[]; waiting: QueueEntry[] }> {
  await settleAttachedByHand();
  const inbox = (await queuedInvoices()).filter((inv) => !inv.postedAt);
  const invoices = await Promise.all(inbox.map(withGbpRate));
  const lines = invoices.length ? await waitingLines() : [];
  const sources = await sourceTexts(invoices.map((i) => i.id));
  const check: QueueEntry[] = [];
  const waiting: QueueEntry[] = [];
  for (const { rejectedLineIds, postedAt: _notPosted, ...invoice } of invoices) {
    const ranked = rankForInvoice({ ...invoice, rejectedLineIds }, lines);
    const worthChecking = !!ranked.addsUp || ranked.suggestions.some(isWorthChecking);
    (worthChecking ? check : waiting).push({ invoice: { ...invoice, sourceText: sources.get(invoice.id) ?? "" }, ...ranked });
  }
  return { check, waiting };
}

export async function rejectLineForInvoice(invoiceId: number, lineId: number, userId: number | null): Promise<void> {
  await db.update(finInvoicesTable)
    .set({ rejectedLineIds: sql`array_append(array_remove(${finInvoicesTable.rejectedLineIds}, ${lineId}::int), ${lineId}::int)`, updatedAt: new Date() })
    .where(eq(finInvoicesTable.id, invoiceId));
  await logFinEvent("invoice", invoiceId, "transaction_rejected", userId, { lineId });
}

/** The bookkeeper has found it in QuickBooks and posted it (Graeme, 6 Nov
 *  2026): out of the Inbox, in the library. A mistake goes back the same way. */
export async function setInvoicePosted(invoiceId: number, posted: boolean, userId: number | null): Promise<boolean> {
  const done = await db.update(finInvoicesTable)
    .set(posted
      ? { postedAt: new Date(), postedBy: userId, updatedAt: new Date() }
      : { postedAt: null, postedBy: null, awaitingTransactionAt: sql`coalesce(${finInvoicesTable.awaitingTransactionAt}, now())`, updatedAt: new Date() })
    .where(and(eq(finInvoicesTable.id, invoiceId), isNull(finInvoicesTable.lineId)))
    .returning({ id: finInvoicesTable.id });
  if (done.length === 0) return false;
  await logFinEvent("invoice", invoiceId, posted ? "marked_posted" : "back_to_inbox", userId);
  return true;
}

/** Shouldn't be here at all: it stays in the library, out of the Inbox. */
export async function takeOutOfQueue(invoiceId: number, userId: number | null): Promise<void> {
  await db.update(finInvoicesTable).set({ awaitingTransactionAt: null, updatedAt: new Date() }).where(eq(finInvoicesTable.id, invoiceId));
  await logFinEvent("invoice", invoiceId, "taken_out_of_queue", userId);
}

export interface AfterImport {
  /** Null when QuickBooks couldn't be checked: the hourly check catches up. */
  foundPosted: number | null;
  autoMatched: number;
  autoDone: number;
  toCheck: number;
}

/** After a card statement: what's already posted, then what matches. A
 *  QuickBooks problem never costs the upload. */
export async function afterCardImport(userId: number | null): Promise<AfterImport> {
  const sync = await Promise.race([
    runQboSync(userId).catch(() => null),
    new Promise<null>((done) => setTimeout(() => done(null), QBO_WAIT_MS).unref()),
  ]);
  const { matched, autoDone } = await matchQueuedInvoices(userId);
  const { check } = await invoiceQueue();
  return {
    foundPosted: !sync || sync.error ? null : sync.linesMarkedPosted,
    autoMatched: matched,
    autoDone,
    toCheck: check.length,
  };
}
