import { and, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { db, finDocumentsTable, finInvoicesTable, finLinesTable, finVendorsTable } from "@workspace/db";
import { autoCompleteIfReady, clearSuggestionsIfInvoiced, logFinEvent } from "./invoice-store";
import { isConfidentPick, rankLinesForInvoice, withoutRejected, type LineCandidate, type LineSuggestion } from "./invoice-to-line";

// Outstanding → "Drop an invoice" (Graeme, 3 Nov 2026): the invoice is
// filed in the library, read, and the transaction it belongs to is put
// forward. Attaching it is the same as uploading it on that line by hand.

export interface SuggestedLine extends LineSuggestion {
  lineDate: string;
  supplier: string;
  descriptor: string;
  amount: string;
  cardLast4: string | null;
  cardholder: string | null;
  status: string;
  posted: boolean;
}

export type WaitingLine = LineCandidate & { cardLast4: string | null; cardholder: string | null; status: string; postedDetectedAt: Date | null };

/** Transactions still waiting for a VAT invoice. */
export async function waitingLines(): Promise<WaitingLine[]> {
  return db
    .select({
      id: finLinesTable.id, lineDate: finLinesTable.lineDate, authDate: finLinesTable.authDate,
      descriptor: finLinesTable.descriptor, merchant: finLinesTable.merchant, amount: finLinesTable.amount,
      originalAmount: finLinesTable.originalAmount, orderReference: finLinesTable.orderReference,
      cardLast4: finLinesTable.cardLast4, cardholder: finLinesTable.cardholder, status: finLinesTable.status,
      postedDetectedAt: finLinesTable.postedDetectedAt, vendorName: finVendorsTable.name,
    })
    .from(finLinesTable)
    .leftJoin(finVendorsTable, eq(finVendorsTable.id, finLinesTable.vendorId))
    .where(and(
      inArray(finLinesTable.status, ["open", "identified", "matched"]),
      isNull(finLinesTable.noVatReason), // a DLA purchase never takes an invoice
      notExists(db.select({ one: sql`1` }).from(finDocumentsTable).where(and(
        eq(finDocumentsTable.lineId, finLinesTable.id),
        eq(finDocumentsTable.docKind, "invoice"),
        isNull(finDocumentsTable.supersededBy),
      ))),
    ));
}

/** The transactions this invoice could belong to, best first. */
export function rankForInvoice(
  inv: { supplierName: string | null; invoiceDate: string | null; invoiceNumber: string | null; totalAmount: string | null; rejectedLineIds: number[] },
  lines: WaitingLine[],
  limit = 5,
): { suggestions: SuggestedLine[]; confident: boolean } {
  const ranked = rankLinesForInvoice(inv, withoutRejected(lines, inv.rejectedLineIds), limit);
  const byId = new Map(lines.map((l) => [l.id, l]));
  return {
    confident: isConfidentPick(ranked),
    suggestions: ranked.map((s) => {
      const l = byId.get(s.lineId)!;
      return {
        ...s, lineDate: l.lineDate, supplier: l.vendorName ?? l.merchant ?? l.descriptor, descriptor: l.descriptor,
        amount: l.amount, cardLast4: l.cardLast4, cardholder: l.cardholder, status: l.status, posted: !!l.postedDetectedAt,
      };
    }),
  };
}

export async function suggestLinesForInvoice(invoiceId: number): Promise<{ suggestions: SuggestedLine[]; confident: boolean }> {
  const [inv] = await db.select({
    supplierName: finInvoicesTable.supplierName, invoiceDate: finInvoicesTable.invoiceDate, invoiceNumber: finInvoicesTable.invoiceNumber,
    totalAmount: finInvoicesTable.totalAmount, rejectedLineIds: finInvoicesTable.rejectedLineIds,
  }).from(finInvoicesTable).where(eq(finInvoicesTable.id, invoiceId));
  if (!inv) return { suggestions: [], confident: false };
  return rankForInvoice(inv, await waitingLines());
}

/** Kind of document the line gets, from what the reader made of the file. */
function lineDocKind(readKind: string): string {
  return readKind === "invoice" || readKind === "receipt" || readKind === "statement" ? readKind : "other";
}

const invoiceSourceRef = (invoiceId: number) => `invoice:${invoiceId}`;

export type AttachResult =
  | { ok: true; documentId: number; autoDone: boolean }
  | { ok: false; status: number; error: string };

export async function attachInvoiceToLine(invoiceId: number, lineId: number, userId: number | null, opts: { auto?: boolean; reasons?: string[] } = {}): Promise<AttachResult> {
  const [inv] = await db.select().from(finInvoicesTable).where(eq(finInvoicesTable.id, invoiceId));
  if (!inv) return { ok: false, status: 404, error: "Invoice not found" };
  if (inv.lineId && inv.lineId !== lineId) return { ok: false, status: 409, error: "This invoice is already attached to another transaction." };
  const [line] = await db.select({ id: finLinesTable.id, status: finLinesTable.status }).from(finLinesTable).where(eq(finLinesTable.id, lineId));
  if (!line) return { ok: false, status: 404, error: "Transaction not found" };
  const [already] = await db.select({ id: finDocumentsTable.id }).from(finDocumentsTable)
    .where(and(eq(finDocumentsTable.lineId, lineId), eq(finDocumentsTable.sha256, inv.sha256), isNull(finDocumentsTable.supersededBy)));
  if (already) return { ok: true, documentId: already.id, autoDone: false };

  const [doc] = await db.insert(finDocumentsTable).values({
    lineId,
    fileBlob: inv.fileBlob,
    fileMime: inv.fileMime,
    fileName: inv.fileName,
    fileSizeBytes: inv.fileSizeBytes,
    sha256: inv.sha256,
    docSource: opts.auto ? "auto_match" : "manual_upload",
    sourceRef: invoiceSourceRef(inv.id),
    docKind: lineDocKind(inv.docKind),
    uploadedBy: userId,
  }).returning({ id: finDocumentsTable.id });

  await db.update(finLinesTable).set({ status: "matched", updatedAt: new Date() })
    .where(and(eq(finLinesTable.id, lineId), inArray(finLinesTable.status, ["open", "identified"])));
  await db.update(finInvoicesTable).set({ lineId, documentId: doc.id, awaitingTransactionAt: null, updatedAt: new Date() }).where(eq(finInvoicesTable.id, invoiceId));

  await logFinEvent("line", lineId, opts.auto ? "invoice_matched_automatically" : "document_added", userId, { fileName: inv.fileName, documentId: doc.id, fromInvoice: inv.id, reasons: opts.reasons });
  await logFinEvent("invoice", inv.id, opts.auto ? "matched_automatically" : "attached_to_transaction", userId, { lineId, reasons: opts.reasons });
  await clearSuggestionsIfInvoiced(lineId);
  const autoDone = await autoCompleteIfReady(lineId, userId, "vat_invoice_attached");
  return { ok: true, documentId: doc.id, autoDone };
}

/** "Wrong transaction": the invoice goes back in the queue and never comes
 *  back to this line. The file stays in the library; only the line's copy
 *  goes. A line that had closed on this invoice opens again. */
export async function detachInvoiceFromLine(invoiceId: number, userId: number | null): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [inv] = await db.select({ lineId: finInvoicesTable.lineId, rejectedLineIds: finInvoicesTable.rejectedLineIds })
    .from(finInvoicesTable).where(eq(finInvoicesTable.id, invoiceId));
  if (!inv) return { ok: false, status: 404, error: "Invoice not found" };
  const lineId = inv.lineId;
  if (!lineId) return { ok: false, status: 409, error: "This invoice isn't attached to a transaction." };

  await db.transaction(async (tx) => {
    await tx.delete(finDocumentsTable).where(and(eq(finDocumentsTable.lineId, lineId), eq(finDocumentsTable.sourceRef, invoiceSourceRef(invoiceId))));
    const [left] = await tx.select({ id: finDocumentsTable.id }).from(finDocumentsTable).where(eq(finDocumentsTable.lineId, lineId)).limit(1);
    await tx.update(finLinesTable).set({ status: left ? "matched" : "open", doneAt: null, doneBy: null, updatedAt: new Date() })
      .where(and(eq(finLinesTable.id, lineId), inArray(finLinesTable.status, ["identified", "matched", "done"])));
    await tx.update(finInvoicesTable).set({
      lineId: null, documentId: null, postedBy: null, postedAt: null, awaitingTransactionAt: new Date(),
      rejectedLineIds: [...new Set([...inv.rejectedLineIds, lineId])], updatedAt: new Date(),
    }).where(eq(finInvoicesTable.id, invoiceId));
  });
  await logFinEvent("line", lineId, "invoice_taken_off", userId, { fromInvoice: invoiceId });
  await logFinEvent("invoice", invoiceId, "taken_off_transaction", userId, { lineId });
  return { ok: true };
}
