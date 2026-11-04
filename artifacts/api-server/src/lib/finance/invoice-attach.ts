import { and, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { db, finDocumentsTable, finInvoicesTable, finLinesTable, finVendorsTable } from "@workspace/db";
import { autoCompleteIfReady, clearSuggestionsIfInvoiced, logFinEvent } from "./invoice-store";
import { isConfidentPick, rankLinesForInvoice, type LineSuggestion } from "./invoice-to-line";

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

/** Transactions still waiting for a VAT invoice, ranked for this one. */
export async function suggestLinesForInvoice(invoiceId: number): Promise<{ suggestions: SuggestedLine[]; confident: boolean }> {
  const [inv] = await db.select().from(finInvoicesTable).where(eq(finInvoicesTable.id, invoiceId));
  if (!inv) return { suggestions: [], confident: false };
  const lines = await db
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
  const ranked = rankLinesForInvoice(
    { supplierName: inv.supplierName, invoiceDate: inv.invoiceDate, invoiceNumber: inv.invoiceNumber, totalAmount: inv.totalAmount },
    lines,
  );
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

/** Kind of document the line gets, from what the reader made of the file. */
function lineDocKind(readKind: string): string {
  return readKind === "invoice" || readKind === "receipt" || readKind === "statement" ? readKind : "other";
}

export type AttachResult =
  | { ok: true; documentId: number; autoDone: boolean }
  | { ok: false; status: number; error: string };

export async function attachInvoiceToLine(invoiceId: number, lineId: number, userId: number | null): Promise<AttachResult> {
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
    docSource: "manual_upload",
    sourceRef: `invoice:${inv.id}`,
    docKind: lineDocKind(inv.docKind),
    uploadedBy: userId,
  }).returning({ id: finDocumentsTable.id });

  await db.update(finLinesTable).set({ status: "matched", updatedAt: new Date() })
    .where(and(eq(finLinesTable.id, lineId), inArray(finLinesTable.status, ["open", "identified"])));
  await db.update(finInvoicesTable).set({ lineId, documentId: doc.id, updatedAt: new Date() }).where(eq(finInvoicesTable.id, invoiceId));

  await logFinEvent("line", lineId, "document_added", userId, { fileName: inv.fileName, documentId: doc.id, fromInvoice: inv.id });
  await logFinEvent("invoice", inv.id, "attached_to_transaction", userId, { lineId });
  await clearSuggestionsIfInvoiced(lineId);
  const autoDone = await autoCompleteIfReady(lineId, userId, "vat_invoice_attached");
  return { ok: true, documentId: doc.id, autoDone };
}
