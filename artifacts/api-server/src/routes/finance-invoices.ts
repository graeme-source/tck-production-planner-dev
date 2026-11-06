import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { z } from "zod/v4";
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, finEventsTable, finInvoiceUploadsTable, finInvoicesTable, finLinesTable, usersTable } from "@workspace/db";
import { validate } from "../middleware/validate";
import { resolveFinanceAccess } from "./finance";
import { extractInvoiceFiles, financialYearOfDate, financialYearRange, invoiceMimeFor, periodRange, sha256Of, supplierHintFromPath } from "../lib/finance/invoice-library";
import { storedFileHeaders } from "../lib/finance/posted-rules";
import { addInvoiceFile, kickInvoiceReader, logFinEvent, pendingInvoiceCount, readInvoiceNow, refreshDuplicate } from "../lib/finance/invoice-store";
import { attachInvoiceToLines, detachInvoiceFromLine, suggestLinesForInvoice } from "../lib/finance/invoice-attach";
import { invoiceQueue, queueInvoice, rejectLineForInvoice, takeOutOfQueue } from "../lib/finance/invoice-queue";

// Finance → Invoices: the searchable library of every invoice we hold
// (Graeme, 3 Nov 2026). Same access as the rest of Finance. Append-only —
// no delete route (6-year retention).

const router: IRouter = Router();

async function requireFinanceAccess(req: Request, res: Response, next: NextFunction) {
  if (await resolveFinanceAccess(req)) { next(); return; }
  res.status(403).json({ error: "Finance access required" });
}

// Zips are normally unpacked in the browser and sent in small batches (so
// size never matters and nothing times out); a zip sent whole still works
// up to this size.
const MAX_UPLOAD_MB = 300;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 200 } });

/** Multer refuses an oversized file before the route runs — say so plainly
 *  instead of a bare 500 (what happened to Graeme's big zip, 3 Nov). */
function receiveFiles(req: Request, res: Response, next: NextFunction) {
  upload.array("files", 200)(req, res, (err: unknown) => {
    if (!err) { next(); return; }
    const code = (err as { code?: string }).code;
    if (code === "LIMIT_FILE_SIZE") { res.status(413).json({ error: `A file is over ${MAX_UPLOAD_MB} MB. Refresh the page and try again — the page now unpacks zips itself, so any size works.` }); return; }
    if (code === "LIMIT_FILE_COUNT") { res.status(413).json({ error: "Too many files in one go — send fewer at a time." }); return; }
    console.error("[finance] invoice upload receive error:", err);
    res.status(400).json({ error: "The upload didn't arrive in one piece — try again." });
  });
}

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  // A financial year, "none" (not dated yet), or absent = every year.
  fy: z.union([z.string().regex(/^\d{4}\/\d{2}$/), z.literal("none")]).optional(),
  period: z.coerce.number().int().min(1).max(12).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.enum(["upload", "transaction"]).optional(),
  // Same invoice as an earlier one: hidden unless asked for.
  duplicates: z.enum(["hide", "only"]).optional(),
  // Just the year tabs (first visit, to open on the latest year).
  yearsOnly: z.literal("1").optional(),
});

/** FY start year of the invoice's own date ("2025" for 2025/26). */
const fyStartYear = sql<number>`extract(year from (${finInvoicesTable.invoiceDate} - interval '3 months'))::int`;

router.get("/", requireFinanceAccess, async (req: Request, res: Response) => {
  try {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ error: "Bad search" }); return; }
    const f = parsed.data;
    // Filters that apply to the year counts too (everything but the year).
    const common: SQL[] = [];
    if (f.q) {
      const like = `%${f.q.replace(/[%_]/g, "\\$&")}%`;
      common.push(or(
        ilike(finInvoicesTable.supplierName, like),
        ilike(finInvoicesTable.invoiceNumber, like),
        ilike(finInvoicesTable.fileName, like),
        ilike(finInvoicesTable.sourcePath, like),
        ilike(finInvoicesTable.notes, like),
        sql`${finInvoicesTable.totalAmount}::text = ${f.q.replace(/[£,]/g, "")}`,
      )!);
    }
    if (f.source) common.push(eq(finInvoicesTable.source, f.source));
    common.push(f.duplicates === "only" ? isNotNull(finInvoicesTable.duplicateOfId) : isNull(finInvoicesTable.duplicateOfId));

    const where = [...common];
    if (f.fy === "none") where.push(isNull(finInvoicesTable.invoiceDate));
    else if (f.fy) {
      const r = f.period ? periodRange(f.fy, f.period) : financialYearRange(f.fy);
      where.push(sql`${finInvoicesTable.invoiceDate} BETWEEN ${r.from} AND ${r.to}`);
    }
    if (f.from) where.push(sql`${finInvoicesTable.invoiceDate} >= ${f.from}`);
    if (f.to) where.push(sql`${finInvoicesTable.invoiceDate} <= ${f.to}`);

    const original = alias(finInvoicesTable, "original");
    const rows = f.yearsOnly ? [] : await db.select({
      id: finInvoicesTable.id,
      fileName: finInvoicesTable.fileName,
      fileMime: finInvoicesTable.fileMime,
      sourcePath: finInvoicesTable.sourcePath,
      fileSizeBytes: finInvoicesTable.fileSizeBytes,
      source: finInvoicesTable.source,
      uploadId: finInvoicesTable.uploadId,
      lineId: finInvoicesTable.lineId,
      supplierName: finInvoicesTable.supplierName,
      invoiceDate: finInvoicesTable.invoiceDate,
      invoiceNumber: finInvoicesTable.invoiceNumber,
      totalAmount: finInvoicesTable.totalAmount,
      vatAmount: finInvoicesTable.vatAmount,
      currency: finInvoicesTable.currency,
      docKind: finInvoicesTable.docKind,
      notes: finInvoicesTable.notes,
      readStatus: finInvoicesTable.readStatus,
      readNote: finInvoicesTable.readNote,
      uploadedBy: finInvoicesTable.uploadedBy,
      postedBy: finInvoicesTable.postedBy,
      postedAt: finInvoicesTable.postedAt,
      duplicateOfId: finInvoicesTable.duplicateOfId,
      duplicateOf: sql<{ supplierName: string | null; invoiceNumber: string | null; invoiceDate: string | null; fileName: string; sourcePath: string | null } | null>`
        CASE WHEN ${original.id} IS NULL THEN NULL ELSE json_build_object(
          'supplierName', ${original.supplierName}, 'invoiceNumber', ${original.invoiceNumber},
          'invoiceDate', ${original.invoiceDate}, 'fileName', ${original.fileName}, 'sourcePath', ${original.sourcePath}) END`,
      createdAt: finInvoicesTable.createdAt,
      updatedAt: finInvoicesTable.updatedAt,
    }).from(finInvoicesTable)
      .leftJoin(original, eq(original.id, finInvoicesTable.duplicateOfId))
      .where(and(...where))
      .orderBy(sql`${finInvoicesTable.invoiceDate} DESC NULLS FIRST`, desc(finInvoicesTable.id))
      .limit(5000);

    const userIds = [...new Set(rows.flatMap((r) => [r.uploadedBy, r.postedBy]).filter((v): v is number => v != null))];
    const users = userIds.length
      ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, userIds))
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));

    // How many (and how much) in each financial year for the same search —
    // the year tabs. "none" = not dated yet (still being read, or unreadable).
    const yearRows = await db.select({
      start: fyStartYear,
      n: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${finInvoicesTable.totalAmount}), 0)::text`,
    }).from(finInvoicesTable).where(and(...common)).groupBy(fyStartYear);
    const years = yearRows.map((y) => ({
      fy: y.start == null ? "none" : `${y.start}/${String((y.start + 1) % 100).padStart(2, "0")}`,
      n: y.n,
      total: y.total,
    })).sort((a, b) => (a.fy === "none" ? -1 : b.fy === "none" ? 1 : b.fy.localeCompare(a.fy)));

    const [dups] = await db.select({ n: sql<number>`count(*)::int` }).from(finInvoicesTable).where(isNotNull(finInvoicesTable.duplicateOfId));

    res.json({
      invoices: rows.map((r) => ({
        ...r,
        financialYear: r.invoiceDate ? financialYearOfDate(r.invoiceDate) : null,
        uploadedByName: r.uploadedBy ? names.get(r.uploadedBy) ?? null : null,
        postedByName: r.postedBy ? names.get(r.postedBy) ?? null : null,
      })),
      years,
      duplicateCount: dups?.n ?? 0,
      pendingReads: await pendingInvoiceCount(),
    });
  } catch (err) {
    console.error("[finance] invoice list error:", err);
    res.status(500).json({ error: "Failed to load invoices" });
  }
});

// Which of these files (by sha256) are already in the library — the page
// asks before sending, so a re-dropped zip costs nothing.
const checkSchema = z.object({ hashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(5000) });
router.post("/check", requireFinanceAccess, validate(checkSchema), async (req: Request, res: Response) => {
  const { hashes } = req.body as z.infer<typeof checkSchema>;
  if (hashes.length === 0) { res.json({ existing: [] }); return; }
  const rows = await db.select({ sha256: finInvoicesTable.sha256 }).from(finInvoicesTable).where(inArray(finInvoicesTable.sha256, hashes));
  res.json({ existing: rows.map((r) => r.sha256) });
});

// One upload = one batch, sent in parts. Start it, send parts to /upload
// with its id, then finish it with what the page skipped.
const startSchema = z.object({ fileName: z.string().trim().min(1).max(500), filesFound: z.number().int().min(0).max(100000) });
router.post("/uploads", requireFinanceAccess, validate(startSchema), async (req: Request, res: Response) => {
  const { fileName, filesFound } = req.body as z.infer<typeof startSchema>;
  const [batch] = await db.insert(finInvoiceUploadsTable)
    .values({ fileName, filesFound, uploadedBy: req.session.userId ?? null, status: "open" })
    .returning({ id: finInvoiceUploadsTable.id });
  res.json(batch);
});

const finishSchema = z.object({ duplicates: z.number().int().min(0), skipped: z.array(z.string().max(500)).max(5000) });
router.post("/uploads/:id/finish", requireFinanceAccess, validate(finishSchema), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { duplicates, skipped } = req.body as z.infer<typeof finishSchema>;
  const [added] = await db.select({ n: sql<number>`count(*)::int` }).from(finInvoicesTable).where(eq(finInvoicesTable.uploadId, id));
  const [row] = await db.update(finInvoiceUploadsTable).set({
    status: "done",
    filesAdded: added?.n ?? 0,
    duplicates: sql`${finInvoiceUploadsTable.duplicates} + ${duplicates}`,
    skipped: sql`${finInvoiceUploadsTable.skipped} || ${JSON.stringify(skipped)}::jsonb`,
  }).where(eq(finInvoiceUploadsTable.id, id)).returning({ id: finInvoiceUploadsTable.id });
  if (!row) { res.status(404).json({ error: "Upload not found" }); return; }
  res.json({ ok: true, filesAdded: added?.n ?? 0 });
});

// Every upload and what it actually added (counted from the library, so an
// upload that broke half-way still shows the truth).
router.get("/uploads", requireFinanceAccess, async (_req: Request, res: Response) => {
  const rows = await db.select({
    id: finInvoiceUploadsTable.id,
    fileName: finInvoiceUploadsTable.fileName,
    filesFound: finInvoiceUploadsTable.filesFound,
    duplicates: finInvoiceUploadsTable.duplicates,
    skipped: finInvoiceUploadsTable.skipped,
    status: finInvoiceUploadsTable.status,
    createdAt: finInvoiceUploadsTable.createdAt,
    uploadedByName: usersTable.name,
    added: sql<number>`(SELECT count(*)::int FROM fin_invoices i WHERE i.upload_id = ${finInvoiceUploadsTable.id})`,
    lastAddedAt: sql<string | null>`(SELECT max(i.created_at) FROM fin_invoices i WHERE i.upload_id = ${finInvoiceUploadsTable.id})`,
  }).from(finInvoiceUploadsTable)
    .leftJoin(usersTable, eq(usersTable.id, finInvoiceUploadsTable.uploadedBy))
    .orderBy(desc(finInvoiceUploadsTable.id)).limit(50);
  res.json({ uploads: rows });
});

// Receive files: PDFs/photos (the page's batches, with uploadId) or whole
// zips (unpacked here). Only PDFs and images are kept.
router.post("/upload", requireFinanceAccess, receiveFiles, async (req: Request, res: Response) => {
  try {
    const incoming = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (incoming.length === 0) { res.status(400).json({ error: "No files uploaded" }); return; }
    const userId = req.session.userId ?? null;
    const summary = { filesFound: 0, filesAdded: 0, duplicates: 0, skipped: [] as string[] };
    // Paths inside the zip, sent alongside each file by the page.
    const paths: string[] = (() => { try { return JSON.parse(String(req.body?.paths ?? "[]")); } catch { return []; } })();
    let batchId = Number(req.body?.uploadId) || null;
    if (batchId) {
      const [b] = await db.select({ id: finInvoiceUploadsTable.id }).from(finInvoiceUploadsTable).where(eq(finInvoiceUploadsTable.id, batchId));
      if (!b) { res.status(404).json({ error: "Upload not found" }); return; }
    } else {
      const batchName = incoming.map((f) => f.originalname).join(", ").slice(0, 500);
      const [b] = await db.insert(finInvoiceUploadsTable).values({ fileName: batchName, uploadedBy: userId }).returning({ id: finInvoiceUploadsTable.id });
      batchId = b.id;
    }

    for (const [i, file] of incoming.entries()) {
      const name = file.originalname || "upload";
      const path = typeof paths[i] === "string" && paths[i] ? paths[i] : name;
      const bytes = new Uint8Array(file.buffer);
      const found = /\.zip$/i.test(name) || file.mimetype === "application/zip" || file.mimetype === "application/x-zip-compressed"
        ? extractInvoiceFiles(bytes, `${name}/`)
        : (() => {
            const mime = invoiceMimeFor(name) ?? (file.mimetype === "application/pdf" || file.mimetype.startsWith("image/") ? file.mimetype : null);
            return mime
              ? { files: [{ path, name: path.split("/").pop() || name, mime, bytes, sha256: sha256Of(bytes) }], skipped: [] as string[] }
              : { files: [], skipped: [`${path} (not a zip, PDF or photo)`] };
          })();
      summary.skipped.push(...found.skipped);
      for (const f of found.files) {
        summary.filesFound++;
        const r = await addInvoiceFile({
          bytes: f.bytes, mime: f.mime, name: f.name, sourcePath: f.path, source: "upload",
          uploadId: batchId, uploadedBy: userId, supplierName: supplierHintFromPath(f.path),
        });
        if (r.duplicate) summary.duplicates++;
        else {
          summary.filesAdded++;
          await logFinEvent("invoice", r.id, "uploaded", userId, { path: f.path, uploadId: batchId });
        }
      }
    }
    // Running totals on the batch (a batch sent in parts adds up as it goes).
    await db.update(finInvoiceUploadsTable).set({
      filesAdded: sql`${finInvoiceUploadsTable.filesAdded} + ${summary.filesAdded}`,
      duplicates: sql`${finInvoiceUploadsTable.duplicates} + ${summary.duplicates}`,
      skipped: sql`${finInvoiceUploadsTable.skipped} || ${JSON.stringify(summary.skipped)}::jsonb`,
      ...(Number(req.body?.uploadId) ? {} : { filesFound: summary.filesFound }),
    }).where(eq(finInvoiceUploadsTable.id, batchId));
    if (summary.filesAdded > 0) kickInvoiceReader();
    res.json({ ...summary, uploadId: batchId });
  } catch (err) {
    console.error("[finance] invoice upload error:", err);
    res.status(500).json({ error: "Upload failed part-way — what arrived before the error is kept. Try again: files already in are skipped." });
  }
});

// ---------------------------------------------------------------------------
// Outstanding → "Drop an invoice" (Graeme, 3 Nov 2026): file it, read it
// now, and put forward the transaction it belongs to. Nothing is attached
// until someone presses "Yes, attach".

function receiveOne(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) { next(); return; }
    if ((err as { code?: string }).code === "LIMIT_FILE_SIZE") { res.status(413).json({ error: `That file is over ${MAX_UPLOAD_MB} MB.` }); return; }
    console.error("[finance] find-transaction receive error:", err);
    res.status(400).json({ error: "The file didn't arrive in one piece — try again." });
  });
}

async function invoiceSummary(id: number) {
  const [inv] = await db.select({
    id: finInvoicesTable.id, fileName: finInvoicesTable.fileName, fileMime: finInvoicesTable.fileMime,
    supplierName: finInvoicesTable.supplierName, invoiceDate: finInvoicesTable.invoiceDate,
    invoiceNumber: finInvoicesTable.invoiceNumber, totalAmount: finInvoicesTable.totalAmount,
    vatAmount: finInvoicesTable.vatAmount, docKind: finInvoicesTable.docKind,
    readStatus: finInvoicesTable.readStatus, readNote: finInvoicesTable.readNote, lineId: finInvoicesTable.lineId,
    notes: finInvoicesTable.notes, paymentStatus: finInvoicesTable.paymentStatus, currency: finInvoicesTable.currency,
  }).from(finInvoicesTable).where(eq(finInvoicesTable.id, id));
  return inv ?? null;
}

async function attachedLine(lineId: number | null) {
  if (!lineId) return null;
  const [l] = await db.select({ id: finLinesTable.id, lineDate: finLinesTable.lineDate, descriptor: finLinesTable.descriptor, amount: finLinesTable.amount, status: finLinesTable.status })
    .from(finLinesTable).where(eq(finLinesTable.id, lineId));
  return l ?? null;
}

router.post("/find-transaction", requireFinanceAccess, receiveOne, async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const name = file.originalname || "invoice";
    const mime = invoiceMimeFor(name) ?? (file.mimetype === "application/pdf" || file.mimetype.startsWith("image/") ? file.mimetype : null);
    if (!mime) { res.status(415).json({ error: `${name} isn't a PDF or a photo.` }); return; }
    const userId = req.session.userId ?? null;
    const r = await addInvoiceFile({ bytes: new Uint8Array(file.buffer), mime, name, sourcePath: name, source: "upload", uploadedBy: userId });
    if (!r.duplicate) {
      await logFinEvent("invoice", r.id, "uploaded", userId, { via: "outstanding_find_transaction" });
      await refreshDuplicate(r.id);
    }
    await readInvoiceNow(r.id);
    const invoice = await invoiceSummary(r.id);
    const already = await attachedLine(invoice?.lineId ?? null);
    if (already) { res.json({ invoice, alreadyAttached: already, suggestions: [], confident: false, addsUp: null }); return; }
    // Add it once: from here it waits for its transaction, found or not.
    await queueInvoice(r.id);
    res.json({ invoice, alreadyAttached: null, ...(await suggestLinesForInvoice(r.id)) });
  } catch (err) {
    console.error("[finance] find-transaction error:", err);
    res.status(500).json({ error: "Couldn't look for the transaction — try again." });
  }
});

router.get("/queue", requireFinanceAccess, async (_req: Request, res: Response) => {
  try {
    res.json(await invoiceQueue());
  } catch (err) {
    console.error("[finance] invoice queue error:", err);
    res.status(500).json({ error: "Couldn't load the invoice queue" });
  }
});

// Look again after the details read off the invoice were corrected.
router.get("/:id/transactions", requireFinanceAccess, async (req: Request, res: Response) => {
  try {
    const invoice = await invoiceSummary(Number(req.params.id));
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
    const already = await attachedLine(invoice.lineId);
    if (already) { res.json({ invoice, alreadyAttached: already, suggestions: [], confident: false, addsUp: null }); return; }
    res.json({ invoice, alreadyAttached: null, ...(await suggestLinesForInvoice(invoice.id)) });
  } catch (err) {
    console.error("[finance] invoice transactions error:", err);
    res.status(500).json({ error: "Couldn't look for the transaction — try again." });
  }
});

const attachSchema = z.object({ lineIds: z.array(z.number().int().positive()).min(1).max(40) });
router.post("/:id/attach", requireFinanceAccess, validate(attachSchema), async (req: Request, res: Response) => {
  try {
    const { lineIds } = req.body as z.infer<typeof attachSchema>;
    const r = await attachInvoiceToLines(Number(req.params.id), lineIds, req.session.userId ?? null);
    if (!r.ok) { res.status(r.status).json({ error: r.error }); return; }
    res.json(r);
  } catch (err) {
    console.error("[finance] invoice attach error:", err);
    res.status(500).json({ error: "Couldn't attach it — try again." });
  }
});

const rejectSchema = z.object({ lineId: z.number().int().positive() });
router.post("/:id/reject-line", requireFinanceAccess, validate(rejectSchema), async (req: Request, res: Response) => {
  try {
    await rejectLineForInvoice(Number(req.params.id), (req.body as z.infer<typeof rejectSchema>).lineId, req.session.userId ?? null);
    res.json({ ok: true });
  } catch (err) {
    console.error("[finance] reject line error:", err);
    res.status(500).json({ error: "Couldn't save that — try again." });
  }
});

router.post("/:id/leave-queue", requireFinanceAccess, validate(z.object({})), async (req: Request, res: Response) => {
  try {
    await takeOutOfQueue(Number(req.params.id), req.session.userId ?? null);
    res.json({ ok: true });
  } catch (err) {
    console.error("[finance] leave queue error:", err);
    res.status(500).json({ error: "Couldn't save that — try again." });
  }
});

router.post("/:id/detach", requireFinanceAccess, validate(z.object({})), async (req: Request, res: Response) => {
  try {
    const r = await detachInvoiceFromLine(Number(req.params.id), req.session.userId ?? null);
    if (!r.ok) { res.status(r.status).json({ error: r.error }); return; }
    res.json(r);
  } catch (err) {
    console.error("[finance] invoice detach error:", err);
    res.status(500).json({ error: "Couldn't take it off — try again." });
  }
});

router.get("/:id/file", requireFinanceAccess, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [inv] = await db.select({ blob: finInvoicesTable.fileBlob, mime: finInvoicesTable.fileMime, name: finInvoicesTable.fileName })
      .from(finInvoicesTable).where(eq(finInvoicesTable.id, id));
    if (!inv) { res.status(404).json({ error: "No file" }); return; }
    const buf = Buffer.isBuffer(inv.blob) ? inv.blob : Buffer.from(inv.blob as any);
    // Sandboxed unless it's a genuine PDF (so Chrome/Edge show it inline).
    for (const [k, v] of Object.entries(storedFileHeaders(inv.mime, buf, inv.name, req.query.download === "1"))) res.setHeader(k, v);
    res.end(buf);
  } catch (err) {
    console.error("[finance] invoice file error:", err);
    res.status(500).json({ error: "Failed to load the file" });
  }
});

const editSchema = z.object({
  supplierName: z.string().trim().max(200).nullable().optional(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  invoiceNumber: z.string().trim().max(100).nullable().optional(),
  totalAmount: z.number().finite().nullable().optional(),
  vatAmount: z.number().finite().nullable().optional(),
  docKind: z.enum(["invoice", "receipt", "credit_note", "statement", "other"]).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  paymentStatus: z.enum(["paid", "unpaid"]).nullable().optional(),
});

router.patch("/:id", requireFinanceAccess, validate(editSchema), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof editSchema>;
    const [before] = await db.select().from(finInvoicesTable).where(eq(finInvoicesTable.id, id));
    if (!before) { res.status(404).json({ error: "Invoice not found" }); return; }
    const updates: Record<string, unknown> = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const set = (key: Extract<keyof typeof before, string>, value: unknown) => {
      if (value === undefined) return;
      const old = before[key];
      if (String(old ?? "") === String(value ?? "")) return;
      updates[key] = value;
      changes[key] = { from: old, to: value };
    };
    set("supplierName", body.supplierName === undefined ? undefined : body.supplierName || null);
    set("invoiceDate", body.invoiceDate);
    set("invoiceNumber", body.invoiceNumber === undefined ? undefined : body.invoiceNumber || null);
    set("totalAmount", body.totalAmount === undefined ? undefined : body.totalAmount === null ? null : body.totalAmount.toFixed(2));
    set("vatAmount", body.vatAmount === undefined ? undefined : body.vatAmount === null ? null : body.vatAmount.toFixed(2));
    set("docKind", body.docKind);
    set("notes", body.notes === undefined ? undefined : body.notes || null);
    set("paymentStatus", body.paymentStatus);
    if (Object.keys(updates).length === 0) { res.json({ ok: true, changed: 0 }); return; }
    await db.update(finInvoicesTable).set({ ...updates, updatedAt: new Date() }).where(eq(finInvoicesTable.id, id));
    await logFinEvent("invoice", id, "edited", req.session.userId, { changes });
    await refreshDuplicate(id);
    res.json({ ok: true, changed: Object.keys(updates).length });
  } catch (err) {
    console.error("[finance] invoice edit error:", err);
    res.status(500).json({ error: "Failed to save" });
  }
});

// "It's not the same invoice" — or undo that.
const notDupSchema = z.object({ notDuplicate: z.boolean() });
router.patch("/:id/duplicate", requireFinanceAccess, validate(notDupSchema), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { notDuplicate } = req.body as z.infer<typeof notDupSchema>;
  const [row] = await db.update(finInvoicesTable).set({ notDuplicate, updatedAt: new Date() })
    .where(eq(finInvoicesTable.id, id)).returning({ id: finInvoicesTable.id });
  if (!row) { res.status(404).json({ error: "Invoice not found" }); return; }
  await refreshDuplicate(id);
  await logFinEvent("invoice", id, notDuplicate ? "marked_not_duplicate" : "unmarked_not_duplicate", req.session.userId);
  res.json({ ok: true });
});

// Ask the reader to try again (after a failure, or a wrong reading).
router.post("/:id/read", requireFinanceAccess, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [row] = await db.update(finInvoicesTable).set({ readStatus: "pending", readNote: null, updatedAt: new Date() })
    .where(eq(finInvoicesTable.id, id)).returning({ id: finInvoicesTable.id });
  if (!row) { res.status(404).json({ error: "Invoice not found" }); return; }
  await logFinEvent("invoice", id, "read_requested", req.session.userId);
  kickInvoiceReader();
  res.json({ ok: true });
});

// Who did what, when — for an invoice or a card transaction.
router.get("/history/:type/:id", requireFinanceAccess, async (req: Request, res: Response) => {
  const type = req.params.type === "line" ? "line" : req.params.type === "invoice" ? "invoice" : null;
  if (!type) { res.status(400).json({ error: "Unknown record type" }); return; }
  const id = Number(req.params.id);
  const events = await db.select().from(finEventsTable)
    .where(and(eq(finEventsTable.entityType, type), eq(finEventsTable.entityId, id)))
    .orderBy(desc(finEventsTable.createdAt), desc(finEventsTable.id))
    .limit(200);
  // An invoice that came from a transaction also shows that transaction's story.
  let lineEvents: typeof events = [];
  let line = null;
  if (type === "invoice") {
    const [inv] = await db.select({ lineId: finInvoicesTable.lineId }).from(finInvoicesTable).where(eq(finInvoicesTable.id, id));
    if (inv?.lineId) {
      lineEvents = await db.select().from(finEventsTable)
        .where(and(eq(finEventsTable.entityType, "line"), eq(finEventsTable.entityId, inv.lineId)))
        .orderBy(desc(finEventsTable.createdAt)).limit(200);
      [line] = await db.select({ id: finLinesTable.id, lineDate: finLinesTable.lineDate, merchant: finLinesTable.merchant, descriptor: finLinesTable.descriptor, amount: finLinesTable.amount, cardLast4: finLinesTable.cardLast4, cardholder: finLinesTable.cardholder })
        .from(finLinesTable).where(eq(finLinesTable.id, inv.lineId));
    }
  }
  res.json({
    events: [...events, ...lineEvents].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    line: line ?? null,
  });
});

export default router;
