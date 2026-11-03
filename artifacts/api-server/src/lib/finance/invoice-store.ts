import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  db, finDocumentsTable, finEventsTable, finInvoicesTable, finLinesTable, finMatchesTable, finVendorsTable, usersTable,
} from "@workspace/db";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../ai/claude";
import { claudeCanRead } from "../uploaded-contract-access";
import { INVOICE_READ_PROMPT, INVOICE_READ_TOOL, invoiceDuplicateKey, normaliseInvoiceReading, sha256Of } from "./invoice-library";
import { isReadyToClose } from "./posted-rules";

// Finance → Invoices library: storing files, the who-did-what log, the
// background reader and the "transaction marked done → into the library"
// hand-off (Graeme, 3 Nov 2026).

/** Record who did what to a finance record, and when. Never throws: a
 *  failed log line must not undo the action it describes. */
export async function logFinEvent(
  entityType: "invoice" | "line",
  entityId: number,
  action: string,
  userId: number | null | undefined,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    let userName: string | null = null;
    if (userId) {
      const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      userName = u?.name ?? null;
    }
    await db.insert(finEventsTable).values({ entityType, entityId, action, detail, userId: userId ?? null, userName });
  } catch (err) {
    console.error("[finance] event log failed:", err);
  }
}

export interface NewInvoiceFile {
  bytes: Uint8Array;
  mime: string;
  name: string;
  sourcePath?: string | null;
  source: "upload" | "transaction";
  uploadId?: number | null;
  uploadedBy?: number | null;
  supplierName?: string | null;
  vendorId?: number | null;
  invoiceDate?: string | null;
  totalAmount?: string | null;
  lineId?: number | null;
  documentId?: number | null;
  postedBy?: number | null;
  postedAt?: Date | null;
}

/** Add a file to the library. The same file (by sha256) is never stored
 *  twice: a repeat returns the existing row, and when the repeat comes from
 *  a transaction, the existing row gains the transaction link + who posted. */
export async function addInvoiceFile(f: NewInvoiceFile): Promise<{ id: number; duplicate: boolean }> {
  const sha256 = sha256Of(f.bytes);
  const [row] = await db.insert(finInvoicesTable).values({
    fileBlob: Buffer.from(f.bytes),
    fileMime: f.mime,
    fileName: f.name,
    sourcePath: f.sourcePath ?? null,
    fileSizeBytes: f.bytes.length,
    sha256,
    source: f.source,
    uploadId: f.uploadId ?? null,
    uploadedBy: f.uploadedBy ?? null,
    supplierName: f.supplierName ?? null,
    vendorId: f.vendorId ?? null,
    invoiceDate: f.invoiceDate ?? null,
    totalAmount: f.totalAmount ?? null,
    lineId: f.lineId ?? null,
    documentId: f.documentId ?? null,
    postedBy: f.postedBy ?? null,
    postedAt: f.postedAt ?? null,
    readStatus: "pending",
  }).onConflictDoNothing({ target: finInvoicesTable.sha256 }).returning({ id: finInvoicesTable.id });
  if (row) return { id: row.id, duplicate: false };

  const [existing] = await db.select({ id: finInvoicesTable.id, lineId: finInvoicesTable.lineId })
    .from(finInvoicesTable).where(eq(finInvoicesTable.sha256, sha256));
  if (f.lineId && !existing.lineId) {
    await db.update(finInvoicesTable).set({
      lineId: f.lineId, documentId: f.documentId ?? null,
      postedBy: f.postedBy ?? null, postedAt: f.postedAt ?? null, updatedAt: new Date(),
    }).where(eq(finInvoicesTable.id, existing.id));
  }
  return { id: existing.id, duplicate: true };
}

/** A transaction was marked done: every file on it goes into the library,
 *  stamped with who marked it done (the person who posted it) and when. */
export async function ingestLineDocuments(lineId: number, userId: number | null): Promise<number> {
  const [line] = await db.select().from(finLinesTable).where(eq(finLinesTable.id, lineId));
  if (!line) return 0;
  const docs = await db.select().from(finDocumentsTable)
    .where(and(eq(finDocumentsTable.lineId, lineId), isNull(finDocumentsTable.supersededBy)));
  if (docs.length === 0) return 0;
  let supplier = line.merchant ?? line.descriptor;
  if (line.vendorId) {
    const [v] = await db.select({ name: finVendorsTable.name }).from(finVendorsTable).where(eq(finVendorsTable.id, line.vendorId));
    if (v) supplier = v.name;
  }
  const now = new Date();
  let added = 0;
  for (const d of docs) {
    const bytes = Buffer.isBuffer(d.fileBlob) ? d.fileBlob : Buffer.from(d.fileBlob as any);
    // Transaction values go in first; the reader then replaces them with
    // what the invoice itself says.
    const r = await addInvoiceFile({
      bytes, mime: d.fileMime, name: d.fileName, source: "transaction",
      supplierName: supplier, vendorId: line.vendorId, invoiceDate: line.lineDate, totalAmount: line.amount,
      lineId, documentId: d.id, postedBy: userId, postedAt: now, uploadedBy: d.uploadedBy,
    });
    if (!r.duplicate) await refreshDuplicate(r.id);
    await logFinEvent("invoice", r.id, r.duplicate ? "linked_to_transaction" : "added_from_transaction", userId, {
      lineId, supplier, amount: line.amount, transactionDate: line.lineDate, fileName: d.fileName,
    });
    if (!r.duplicate) added++;
  }
  if (added > 0) kickInvoiceReader();
  return added;
}

/** Close the line if it's now posted AND has a VAT invoice — called after
 *  any action that could complete the pair. The person whose action
 *  completed it is recorded as marking it done (null = the QuickBooks sync). */
export async function autoCompleteIfReady(lineId: number, userId: number | null, trigger: string): Promise<boolean> {
  const [line] = await db.select({ status: finLinesTable.status, postedDetectedAt: finLinesTable.postedDetectedAt })
    .from(finLinesTable).where(eq(finLinesTable.id, lineId));
  if (!line) return false;
  const [inv] = await db.select({ id: finDocumentsTable.id }).from(finDocumentsTable)
    .where(and(eq(finDocumentsTable.lineId, lineId), eq(finDocumentsTable.docKind, "invoice"), isNull(finDocumentsTable.supersededBy)))
    .limit(1);
  if (!isReadyToClose(line, Boolean(inv))) return false;
  const now = new Date();
  const [row] = await db.update(finLinesTable)
    .set({ status: "done", doneAt: now, doneBy: userId, updatedAt: now })
    .where(and(eq(finLinesTable.id, lineId), sql`${finLinesTable.status} IN ('open', 'identified', 'matched')`))
    .returning({ id: finLinesTable.id });
  if (!row) return false;
  await logFinEvent("line", lineId, "auto_done", userId, { trigger, from: line.status });
  await ingestLineDocuments(lineId, userId);
  return true;
}

/** Once a line has its VAT invoice, the mailbox suggestions are noise
 *  (Graeme, 2026-11-03): clear the open ones. Rejected/confirmed stay. */
export async function clearSuggestionsIfInvoiced(lineId: number): Promise<number> {
  const [inv] = await db.select({ id: finDocumentsTable.id }).from(finDocumentsTable)
    .where(and(eq(finDocumentsTable.lineId, lineId), eq(finDocumentsTable.docKind, "invoice"), isNull(finDocumentsTable.supersededBy)))
    .limit(1);
  if (!inv) return 0;
  const cleared = await db.update(finMatchesTable).set({ state: "cleared", decidedAt: new Date() })
    .where(and(eq(finMatchesTable.lineId, lineId), eq(finMatchesTable.state, "suggested")))
    .returning({ id: finMatchesTable.id });
  return cleared.length;
}

/** Boot: clear suggestions on every line that already has a VAT invoice. */
export async function clearSuggestionsOnInvoicedLines(): Promise<number> {
  const rows = (await db.execute<{ id: number }>(sql`
    UPDATE fin_matches m SET state = 'cleared', decided_at = NOW()
     WHERE m.state = 'suggested'
       AND EXISTS (SELECT 1 FROM fin_documents d WHERE d.line_id = m.line_id AND d.doc_kind = 'invoice' AND d.superseded_by IS NULL)
    RETURNING m.id
  `) as any).rows ?? [];
  return rows.length;
}

/** Boot sweep: close any line that already met the rule before it existed. */
export async function autoCompleteReadyLines(): Promise<number> {
  const rows = (await db.execute<{ id: number }>(sql`
    SELECT l.id FROM fin_lines l
     WHERE l.status IN ('open', 'identified', 'matched') AND l.posted_detected_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM fin_documents d WHERE d.line_id = l.id AND d.doc_kind = 'invoice' AND d.superseded_by IS NULL)
  `) as any).rows ?? [];
  let n = 0;
  for (const r of rows) if (await autoCompleteIfReady(r.id, null, "posted_and_invoice_already")) n++;
  return n;
}

// ---------------------------------------------------------------------------
// The same invoice as a different file (Graeme, 2026-11-03: "make sure we
// can't double-upload the same invoice"). The earliest copy is the
// original; later ones point at it and drop out of the library view.

export async function refreshDuplicate(id: number): Promise<number | null> {
  const [inv] = await db.select({
    supplierName: finInvoicesTable.supplierName, invoiceNumber: finInvoicesTable.invoiceNumber,
    invoiceDate: finInvoicesTable.invoiceDate, totalAmount: finInvoicesTable.totalAmount,
    notDuplicate: finInvoicesTable.notDuplicate, duplicateOfId: finInvoicesTable.duplicateOfId,
  }).from(finInvoicesTable).where(eq(finInvoicesTable.id, id));
  if (!inv) return null;
  const key = invoiceDuplicateKey(inv);
  let original: number | null = null;
  if (key && !inv.notDuplicate) {
    const [o] = await db.select({ id: finInvoicesTable.id }).from(finInvoicesTable)
      .where(and(eq(finInvoicesTable.dupKey, key), isNull(finInvoicesTable.duplicateOfId), sql`${finInvoicesTable.id} < ${id}`))
      .orderBy(asc(finInvoicesTable.id)).limit(1);
    original = o?.id ?? null;
  }
  await db.update(finInvoicesTable).set({ dupKey: key, duplicateOfId: original }).where(eq(finInvoicesTable.id, id));
  if (original && original !== inv.duplicateOfId) {
    await logFinEvent("invoice", id, "flagged_duplicate", null, { of: original, key });
  }
  return original;
}

/** Boot: key every read invoice and flag duplicates among them, oldest first. */
export async function sweepDuplicates(): Promise<number> {
  const rows = await db.select({ id: finInvoicesTable.id }).from(finInvoicesTable)
    .where(and(sql`${finInvoicesTable.readStatus} <> 'pending'`, isNull(finInvoicesTable.dupKey)))
    .orderBy(asc(finInvoicesTable.id));
  let flagged = 0;
  for (const r of rows) if (await refreshDuplicate(r.id)) flagged++;
  return flagged;
}

// ---------------------------------------------------------------------------
// Background reader: Claude reads supplier, date, number and amounts off
// each new file, one at a time. Single-flight; kicked on upload and on boot.

let readerRunning = false;

export function kickInvoiceReader(): void {
  if (readerRunning) return;
  readerRunning = true;
  readPendingInvoices()
    .catch((err) => console.error("[finance] invoice reader crashed:", err))
    .finally(() => { readerRunning = false; });
}

async function readPendingInvoices(): Promise<void> {
  for (let n = 0; n < 2000; n++) {
    const [inv] = await db.select({ id: finInvoicesTable.id, mime: finInvoicesTable.fileMime, size: finInvoicesTable.fileSizeBytes })
      .from(finInvoicesTable).where(eq(finInvoicesTable.readStatus, "pending"))
      .orderBy(asc(finInvoicesTable.id)).limit(1);
    if (!inv) return;
    await readOneInvoice(inv.id, inv.mime, inv.size);
  }
}

async function readOneInvoice(id: number, mime: string, size: number): Promise<void> {
  const finish = async (readStatus: string, readNote: string | null, fields: Record<string, unknown> = {}) => {
    await db.update(finInvoicesTable).set({ ...fields, readStatus, readNote, updatedAt: new Date() }).where(eq(finInvoicesTable.id, id));
  };
  if (!isClaudeConfigured()) {
    await finish("not_available", "Automatic reading needs the Anthropic API key — fill the details in by hand.");
    return;
  }
  const readable = claudeCanRead(mime, size);
  if (!readable.ok) {
    await finish("failed", readable.reason);
    await logFinEvent("invoice", id, "read_failed", null, { reason: readable.reason });
    return;
  }
  const [inv] = await db.select({ blob: finInvoicesTable.fileBlob }).from(finInvoicesTable).where(eq(finInvoicesTable.id, id));
  const b64 = (Buffer.isBuffer(inv.blob) ? inv.blob : Buffer.from(inv.blob as any)).toString("base64");
  const block: Anthropic.ContentBlockParam = mime === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: mime as "image/jpeg" | "image/png" | "image/webp", data: b64 } };
  try {
    const response = await getClaudeClient().messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 800,
      tool_choice: { type: "tool", name: INVOICE_READ_TOOL.name },
      tools: [INVOICE_READ_TOOL as unknown as Anthropic.Tool],
      messages: [{ role: "user", content: [block, { type: "text", text: INVOICE_READ_PROMPT }] }],
    });
    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") throw new Error("no fields returned");
    const r = normaliseInvoiceReading(toolUse.input);
    // Only what it could read replaces what's there (folder/transaction hints).
    const fields: Record<string, unknown> = { currency: r.currency, docKind: r.docKind };
    if (r.supplierName) fields.supplierName = r.supplierName;
    if (r.invoiceDate) fields.invoiceDate = r.invoiceDate;
    if (r.invoiceNumber) fields.invoiceNumber = r.invoiceNumber;
    if (r.totalAmount) fields.totalAmount = r.totalAmount;
    if (r.vatAmount) fields.vatAmount = r.vatAmount;
    await finish("done", null, fields);
    await logFinEvent("invoice", id, "read", null, { by: CLAUDE_MODELS.sonnet, ...r });
    await refreshDuplicate(id);
  } catch (err) {
    console.error(`[finance] invoice ${id} read failed:`, err instanceof Error ? err.message : err);
    await finish("failed", "Couldn't read it automatically — fill the details in by hand, or press Read again.");
    await logFinEvent("invoice", id, "read_failed", null, { reason: err instanceof Error ? err.message : String(err) });
  }
}

/** Boot: pick up anything left pending by a restart, then check every 10 min. */
export function startInvoiceReaderTimer(): void {
  setTimeout(() => {
    clearSuggestionsOnInvoicedLines()
      .then((n) => { if (n > 0) console.log(`[finance] cleared ${n} mailbox suggestions on lines that already have a VAT invoice`); })
      .catch((e) => console.error("[finance] suggestion clear sweep failed:", e));
    autoCompleteReadyLines()
      .then((n) => { if (n > 0) console.log(`[finance] ${n} lines were posted with a VAT invoice — marked done`); })
      .catch((e) => console.error("[finance] auto-complete sweep failed:", e));
  }, 20_000).unref();
  setTimeout(() => {
    sweepDuplicates()
      .then((n) => { if (n > 0) console.log(`[finance] ${n} invoices flagged as the same invoice as an earlier one`); })
      .catch((e) => console.error("[finance] duplicate sweep failed:", e));
  }, 30_000).unref();
  setTimeout(kickInvoiceReader, 60_000).unref();
  setInterval(kickInvoiceReader, 10 * 60_000).unref();
}

/** How many files are still waiting to be read (for the upload panel). */
export async function pendingInvoiceCount(): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(finInvoicesTable).where(eq(finInvoicesTable.readStatus, "pending"));
  return r?.n ?? 0;
}
