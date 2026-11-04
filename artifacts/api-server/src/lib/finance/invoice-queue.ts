import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, finInvoicesTable } from "@workspace/db";
import { attachInvoiceToLine, rankForInvoice, waitingLines, type SuggestedLine } from "./invoice-attach";
import { logFinEvent } from "./invoice-store";
import { pickCertainMatches } from "./invoice-to-line";
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
  rejectedLineIds: finInvoicesTable.rejectedLineIds, awaitingTransactionAt: finInvoicesTable.awaitingTransactionAt,
};

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
    for (const pick of pickCertainMatches(invoices, await waitingLines())) {
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

type QueuedRow = Awaited<ReturnType<typeof queuedInvoices>>[number];
export type QueueEntry = { invoice: Omit<QueuedRow, "rejectedLineIds">; suggestions: SuggestedLine[]; confident: boolean };

/** `check` has a transaction with the same amount or reference for someone to
 *  look at; `waiting` has nothing that good yet. A shared supplier alone isn't
 *  worth interrupting anyone: it describes every invoice from a regular. */
export async function invoiceQueue(): Promise<{ check: QueueEntry[]; waiting: QueueEntry[] }> {
  await settleAttachedByHand();
  const invoices = await queuedInvoices();
  const lines = invoices.length ? await waitingLines() : [];
  const check: QueueEntry[] = [];
  const waiting: QueueEntry[] = [];
  for (const { rejectedLineIds, ...invoice } of invoices) {
    const ranked = rankForInvoice({ ...invoice, rejectedLineIds }, lines, 3);
    const worthChecking = ranked.suggestions.some((s) => s.evidence.amount || s.evidence.reference);
    (worthChecking ? check : waiting).push({ invoice, ...ranked });
  }
  return { check, waiting };
}

export async function rejectLineForInvoice(invoiceId: number, lineId: number, userId: number | null): Promise<void> {
  await db.update(finInvoicesTable)
    .set({ rejectedLineIds: sql`array_append(array_remove(${finInvoicesTable.rejectedLineIds}, ${lineId}::int), ${lineId}::int)`, updatedAt: new Date() })
    .where(eq(finInvoicesTable.id, invoiceId));
  await logFinEvent("invoice", invoiceId, "transaction_rejected", userId, { lineId });
}

/** Paid some other way: it stays in the library, out of the queue. */
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
