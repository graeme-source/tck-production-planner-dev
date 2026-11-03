import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { z } from "zod/v4";
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, finEventsTable, finInvoiceUploadsTable, finInvoicesTable, finLinesTable, usersTable } from "@workspace/db";
import { validate } from "../middleware/validate";
import { resolveFinanceAccess } from "./finance";
import { extractInvoiceFiles, financialYearOfDate, financialYearRange, invoiceMimeFor, periodRange, sha256Of, supplierHintFromPath } from "../lib/finance/invoice-library";
import { addInvoiceFile, kickInvoiceReader, logFinEvent, pendingInvoiceCount } from "../lib/finance/invoice-store";

// Finance → Invoices: the searchable library of every invoice we hold
// (Graeme, 3 Nov 2026). Same access as the rest of Finance. Append-only —
// no delete route (6-year retention).

const router: IRouter = Router();

async function requireFinanceAccess(req: Request, res: Response, next: NextFunction) {
  if (await resolveFinanceAccess(req)) { next(); return; }
  res.status(403).json({ error: "Finance access required" });
}

// A year of invoices in one zip can be big; files are held in memory only
// while they're unpacked into the database.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024 * 1024, files: 50 } });

/** The date an invoice is filed under: its own date, else the day it arrived. */
const effectiveDate = sql<string>`coalesce(${finInvoicesTable.invoiceDate}, ${finInvoicesTable.createdAt}::date)`;

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  fy: z.string().regex(/^\d{4}\/\d{2}$/).optional(),
  period: z.coerce.number().int().min(1).max(12).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.enum(["upload", "transaction"]).optional(),
});

router.get("/", requireFinanceAccess, async (req: Request, res: Response) => {
  try {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ error: "Bad search" }); return; }
    const f = parsed.data;
    const where: SQL[] = [];
    if (f.q) {
      const like = `%${f.q.replace(/[%_]/g, "\\$&")}%`;
      where.push(or(
        ilike(finInvoicesTable.supplierName, like),
        ilike(finInvoicesTable.invoiceNumber, like),
        ilike(finInvoicesTable.fileName, like),
        ilike(finInvoicesTable.sourcePath, like),
        ilike(finInvoicesTable.notes, like),
        sql`${finInvoicesTable.totalAmount}::text = ${f.q.replace(/[£,]/g, "")}`,
      )!);
    }
    if (f.fy && f.period) {
      const r = periodRange(f.fy, f.period);
      where.push(sql`${effectiveDate} BETWEEN ${r.from} AND ${r.to}`);
    } else if (f.fy) {
      const r = financialYearRange(f.fy);
      where.push(sql`${effectiveDate} BETWEEN ${r.from} AND ${r.to}`);
    }
    if (f.from) where.push(sql`${effectiveDate} >= ${f.from}`);
    if (f.to) where.push(sql`${effectiveDate} <= ${f.to}`);
    if (f.source) where.push(eq(finInvoicesTable.source, f.source));

    const rows = await db.select({
      id: finInvoicesTable.id,
      fileName: finInvoicesTable.fileName,
      fileMime: finInvoicesTable.fileMime,
      sourcePath: finInvoicesTable.sourcePath,
      fileSizeBytes: finInvoicesTable.fileSizeBytes,
      source: finInvoicesTable.source,
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
      createdAt: finInvoicesTable.createdAt,
      updatedAt: finInvoicesTable.updatedAt,
      filedOn: effectiveDate,
    }).from(finInvoicesTable)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(effectiveDate), desc(finInvoicesTable.id))
      .limit(2000);

    const userIds = [...new Set(rows.flatMap((r) => [r.uploadedBy, r.postedBy]).filter((v): v is number => v != null))];
    const users = userIds.length
      ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, userIds))
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));

    // Every financial year we hold anything in, for the year picker.
    const years = await db.selectDistinct({ d: sql<string>`date_trunc('month', ${effectiveDate})::date::text` }).from(finInvoicesTable);
    const financialYears = [...new Set(years.map((y) => financialYearOfDate(y.d)))].sort().reverse();

    res.json({
      invoices: rows.map((r) => ({
        ...r,
        financialYear: financialYearOfDate(r.filedOn),
        uploadedByName: r.uploadedBy ? names.get(r.uploadedBy) ?? null : null,
        postedByName: r.postedBy ? names.get(r.postedBy) ?? null : null,
      })),
      financialYears,
      pendingReads: await pendingInvoiceCount(),
    });
  } catch (err) {
    console.error("[finance] invoice list error:", err);
    res.status(500).json({ error: "Failed to load invoices" });
  }
});

// Drop zips, PDFs or photos. Zips are unpacked; only PDFs and images are kept.
router.post("/upload", requireFinanceAccess, upload.array("files", 50), async (req: Request, res: Response) => {
  try {
    const incoming = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (incoming.length === 0) { res.status(400).json({ error: "No files uploaded" }); return; }
    const userId = req.session.userId ?? null;
    const summary = { filesFound: 0, filesAdded: 0, duplicates: 0, skipped: [] as string[] };
    const batchName = incoming.map((f) => f.originalname).join(", ").slice(0, 500);
    const [batch] = await db.insert(finInvoiceUploadsTable).values({ fileName: batchName, uploadedBy: userId }).returning({ id: finInvoiceUploadsTable.id });

    for (const file of incoming) {
      const name = file.originalname || "upload";
      const bytes = new Uint8Array(file.buffer);
      const found = /\.zip$/i.test(name) || file.mimetype === "application/zip" || file.mimetype === "application/x-zip-compressed"
        ? extractInvoiceFiles(bytes, `${name}/`)
        : (() => {
            const mime = invoiceMimeFor(name) ?? (file.mimetype === "application/pdf" || file.mimetype.startsWith("image/") ? file.mimetype : null);
            return mime
              ? { files: [{ path: name, name, mime, bytes, sha256: sha256Of(bytes) }], skipped: [] as string[] }
              : { files: [], skipped: [`${name} (not a zip, PDF or photo)`] };
          })();
      summary.skipped.push(...found.skipped);
      for (const f of found.files) {
        summary.filesFound++;
        const r = await addInvoiceFile({
          bytes: f.bytes, mime: f.mime, name: f.name, sourcePath: f.path, source: "upload",
          uploadId: batch.id, uploadedBy: userId, supplierName: supplierHintFromPath(f.path),
        });
        if (r.duplicate) summary.duplicates++;
        else {
          summary.filesAdded++;
          await logFinEvent("invoice", r.id, "uploaded", userId, { from: name, path: f.path });
        }
      }
    }
    await db.update(finInvoiceUploadsTable).set({
      filesFound: summary.filesFound, filesAdded: summary.filesAdded, duplicates: summary.duplicates, skipped: summary.skipped,
    }).where(eq(finInvoiceUploadsTable.id, batch.id));
    if (summary.filesAdded > 0) kickInvoiceReader();
    res.json(summary);
  } catch (err: any) {
    if (err?.code === "LIMIT_FILE_SIZE") { res.status(413).json({ error: "That file is over 300 MB — split the zip into smaller ones." }); return; }
    console.error("[finance] invoice upload error:", err);
    res.status(500).json({ error: "Upload failed — nothing after the error was stored. Try again." });
  }
});

router.get("/:id/file", requireFinanceAccess, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [inv] = await db.select({ blob: finInvoicesTable.fileBlob, mime: finInvoicesTable.fileMime, name: finInvoicesTable.fileName })
      .from(finInvoicesTable).where(eq(finInvoicesTable.id, id));
    if (!inv) { res.status(404).json({ error: "No file" }); return; }
    const buf = Buffer.isBuffer(inv.blob) ? inv.blob : Buffer.from(inv.blob as any);
    res.setHeader("Content-Type", inv.mime || "application/octet-stream");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="${inv.name.replace(/["\r\n]/g, "")}"`);
    // Files come from anywhere — sandbox the response, as for documents.
    res.setHeader("Content-Security-Policy", "sandbox");
    res.setHeader("X-Content-Type-Options", "nosniff");
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
    if (Object.keys(updates).length === 0) { res.json({ ok: true, changed: 0 }); return; }
    await db.update(finInvoicesTable).set({ ...updates, updatedAt: new Date() }).where(eq(finInvoicesTable.id, id));
    await logFinEvent("invoice", id, "edited", req.session.userId, { changes });
    res.json({ ok: true, changed: Object.keys(updates).length });
  } catch (err) {
    console.error("[finance] invoice edit error:", err);
    res.status(500).json({ error: "Failed to save" });
  }
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
