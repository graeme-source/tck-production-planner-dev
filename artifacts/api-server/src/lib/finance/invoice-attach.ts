import { and, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { db, finDocumentsTable, finInvoicesTable, finLinesTable, finVendorsTable } from "@workspace/db";
import { autoCompleteIfReady, clearSuggestionsIfInvoiced, logFinEvent } from "./invoice-store";
import { chargesThatAddUp, isConfidentPick, rankLinesForInvoice, withoutRejected, type LineCandidate, type LineSuggestion } from "./invoice-to-line";

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

const MOST_TO_SHOW = 30;

export type InvoiceMatches = { suggestions: SuggestedLine[]; confident: boolean; addsUp: number[] | null };

/** The transactions this invoice could belong to, best first, and any set of
 *  them that comes to the invoice total. */
export function rankForInvoice(
  inv: { supplierName: string | null; invoiceDate: string | null; invoiceNumber: string | null; totalAmount: string | null; rejectedLineIds: number[] },
  lines: WaitingLine[],
): InvoiceMatches {
  const open = withoutRejected(lines, inv.rejectedLineIds);
  const ranked = rankLinesForInvoice(inv, open, Infinity);
  const addsUp = chargesThatAddUp(inv, open);
  const byId = new Map(lines.map((l) => [l.id, l]));
  return {
    confident: isConfidentPick(ranked),
    addsUp,
    suggestions: ranked.filter((s, i) => i < MOST_TO_SHOW || addsUp?.includes(s.lineId)).map((s) => {
      const l = byId.get(s.lineId)!;
      return {
        ...s, lineDate: l.lineDate, supplier: l.vendorName ?? l.merchant ?? l.descriptor, descriptor: l.descriptor,
        amount: l.amount, cardLast4: l.cardLast4, cardholder: l.cardholder, status: l.status, posted: !!l.postedDetectedAt,
      };
    }),
  };
}

export async function suggestLinesForInvoice(invoiceId: number): Promise<InvoiceMatches> {
  const [inv] = await db.select({
    supplierName: finInvoicesTable.supplierName, invoiceDate: finInvoicesTable.invoiceDate, invoiceNumber: finInvoicesTable.invoiceNumber,
    totalAmount: finInvoicesTable.totalAmount, rejectedLineIds: finInvoicesTable.rejectedLineIds,
  }).from(finInvoicesTable).where(eq(finInvoicesTable.id, invoiceId));
  if (!inv) return { suggestions: [], confident: false, addsUp: null };
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

export async function attachInvoiceToLine(invoiceId: number, lineId: number, userId: number | null, opts: { auto?: boolean; reasons?: string[]; alsoCovers?: boolean } = {}): Promise<AttachResult> {
  const [inv] = await db.select().from(finInvoicesTable).where(eq(finInvoicesTable.id, invoiceId));
  if (!inv) return { ok: false, status: 404, error: "Invoice not found" };
  if (inv.lineId && inv.lineId !== lineId && !opts.alsoCovers) return { ok: false, status: 409, error: "This invoice is already attached to another transaction." };
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
  await db.update(finInvoicesTable).set({ ...(opts.alsoCovers ? {} : { lineId, documentId: doc.id }), awaitingTransactionAt: null, updatedAt: new Date() }).where(eq(finInvoicesTable.id, invoiceId));

  await logFinEvent("line", lineId, opts.auto ? "invoice_matched_automatically" : "document_added", userId, { fileName: inv.fileName, documentId: doc.id, fromInvoice: inv.id, reasons: opts.reasons });
  await logFinEvent("invoice", inv.id, opts.auto ? "matched_automatically" : "attached_to_transaction", userId, { lineId, reasons: opts.reasons });
  await clearSuggestionsIfInvoiced(lineId);
  const autoDone = await autoCompleteIfReady(lineId, userId, "vat_invoice_attached");
  return { ok: true, documentId: doc.id, autoDone };
}

/** One invoice on one transaction, or on all the charges it covers: each gets
 *  its own copy, and the invoice's line_id stays the first of them. */
export async function attachInvoiceToLines(invoiceId: number, lineIds: number[], userId: number | null): Promise<
  { ok: true; attached: number; autoDone: number } | { ok: false; status: number; error: string }
> {
  const ids = [...new Set(lineIds)];
  const found = await db.select({ id: finLinesTable.id }).from(finLinesTable).where(inArray(finLinesTable.id, ids));
  if (found.length !== ids.length) return { ok: false, status: 404, error: "Transaction not found" };
  let autoDone = 0;
  for (const [i, lineId] of ids.entries()) {
    const r = await attachInvoiceToLine(invoiceId, lineId, userId, { alsoCovers: i > 0 });
    if (!r.ok) return r;
    if (r.autoDone) autoDone++;
  }
  return { ok: true, attached: ids.length, autoDone };
}

/** "Wrong transaction": the invoice goes back in the queue, off every
 *  transaction it was on, and won't be offered for a single one again. Off a
 *  set of charges it can come back: only that set was wrong. The file stays in
 *  the library; only the copies go. A line that had closed on this invoice
 *  opens again. */
export async function detachInvoiceFromLine(invoiceId: number, userId: number | null): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [inv] = await db.select({ lineId: finInvoicesTable.lineId, rejectedLineIds: finInvoicesTable.rejectedLineIds })
    .from(finInvoicesTable).where(eq(finInvoicesTable.id, invoiceId));
  if (!inv) return { ok: false, status: 404, error: "Invoice not found" };
  if (!inv.lineId) return { ok: false, status: 409, error: "This invoice isn't attached to a transaction." };
  const copies = await db.select({ lineId: finDocumentsTable.lineId }).from(finDocumentsTable).where(eq(finDocumentsTable.sourceRef, invoiceSourceRef(invoiceId)));
  const lineIds = [...new Set([inv.lineId, ...copies.map((c) => c.lineId)])];

  await db.transaction(async (tx) => {
    await tx.delete(finDocumentsTable).where(eq(finDocumentsTable.sourceRef, invoiceSourceRef(invoiceId)));
    for (const lineId of lineIds) {
      const [left] = await tx.select({ id: finDocumentsTable.id }).from(finDocumentsTable).where(eq(finDocumentsTable.lineId, lineId)).limit(1);
      await tx.update(finLinesTable).set({ status: left ? "matched" : "open", doneAt: null, doneBy: null, updatedAt: new Date() })
        .where(and(eq(finLinesTable.id, lineId), inArray(finLinesTable.status, ["identified", "matched", "done"])));
    }
    await tx.update(finInvoicesTable).set({
      lineId: null, documentId: null, postedBy: null, postedAt: null, awaitingTransactionAt: new Date(),
      rejectedLineIds: lineIds.length === 1 ? [...new Set([...inv.rejectedLineIds, ...lineIds])] : inv.rejectedLineIds, updatedAt: new Date(),
    }).where(eq(finInvoicesTable.id, invoiceId));
  });
  for (const lineId of lineIds) {
    await logFinEvent("line", lineId, "invoice_taken_off", userId, { fromInvoice: invoiceId });
    await logFinEvent("invoice", invoiceId, "taken_off_transaction", userId, { lineId });
  }
  return { ok: true };
}
