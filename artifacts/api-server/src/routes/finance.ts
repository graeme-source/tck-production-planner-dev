import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { createHash } from "crypto";
import { z } from "zod/v4";
import {
  db,
  finDocumentsTable,
  finEmailIndexTable,
  finLinesTable,
  finMailboxTable,
  finMatchesTable,
  finStatementUploadsTable,
  finVendorsTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { requireAdmin } from "../middleware/roles";
import { parseCotCsv } from "../lib/finance/cot-csv";
import { normaliseMerchant } from "../lib/finance/merchant-normalise";
import { sealSecret } from "../lib/finance/secret-box";
import { runMailboxSync, refreshSuggestions, fetchAttachmentForMessage } from "../lib/finance/mailbox-sync";
import { authorizeUrl, exchangeCode, newStateToken, qboConfigured, qboStatus, runQboSync } from "../lib/finance/qbo";
import { db as dbForQbo, finQboConnectionTable } from "@workspace/db";

// Finance / VAT invoice reconciliation (docs/vat-reconciliation/PLAN.md).
// Replaces the "Outstanding Transactions" Google Sheet. Access: admin, or a
// user with the isBookkeeper flag. Everything mailbox-touching (connection
// settings, raw index rows) stays admin-only at the route layer — bookkeepers
// see documents the app has attached, never raw email.

const router: IRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ---------------------------------------------------------------------------
// Access guards

async function resolveFinanceAccess(req: Request): Promise<"admin" | "bookkeeper" | null> {
  if (req.session.userRole === "admin") return "admin";
  if (!req.session.userId) return null;
  const [user] = await db
    .select({ role: usersTable.role, isBookkeeper: usersTable.isBookkeeper })
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId));
  if (!user) return null;
  if (user.role === "admin") return "admin";
  if (user.isBookkeeper) return "bookkeeper";
  return null;
}

async function requireFinanceAccess(req: Request, res: Response, next: NextFunction) {
  const access = await resolveFinanceAccess(req);
  if (access) { next(); return; }
  res.status(403).json({ error: "Finance access required" });
}

// ---------------------------------------------------------------------------
// Vendors — find-or-create by normalised merchant key

async function findOrCreateVendor(merchantRaw: string): Promise<number | null> {
  const normalised = normaliseMerchant(merchantRaw);
  if (!normalised) return null;
  const [existing] = await db
    .select({ id: finVendorsTable.id })
    .from(finVendorsTable)
    .where(eq(finVendorsTable.normalisedName, normalised));
  if (existing) return existing.id;
  const [created] = await db
    .insert(finVendorsTable)
    .values({ name: titleCase(normalised), normalisedName: normalised })
    .onConflictDoNothing({ target: finVendorsTable.normalisedName })
    .returning({ id: finVendorsTable.id });
  if (created) return created.id;
  const [raced] = await db
    .select({ id: finVendorsTable.id })
    .from(finVendorsTable)
    .where(eq(finVendorsTable.normalisedName, normalised));
  return raced?.id ?? null;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Summary + lines

router.get("/summary", requireFinanceAccess, async (_req: Request, res: Response) => {
  try {
    const counts = await db
      .select({ status: finLinesTable.status, n: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${finLinesTable.amount}), 0)` })
      .from(finLinesTable)
      .groupBy(finLinesTable.status);
    const [lastUpload] = await db
      .select()
      .from(finStatementUploadsTable)
      .orderBy(desc(finStatementUploadsTable.createdAt))
      .limit(1);
    const [mailbox] = await db
      .select({
        emailAddress: finMailboxTable.emailAddress,
        lastSyncAt: finMailboxTable.lastSyncAt,
        lastError: finMailboxTable.lastError,
      })
      .from(finMailboxTable)
      .limit(1);
    res.json({
      counts,
      lastUpload: lastUpload ? { at: lastUpload.createdAt, source: lastUpload.source, newCount: lastUpload.newCount } : null,
      mailbox: mailbox ?? null,
    });
  } catch (err) {
    console.error("[finance] summary error:", err);
    res.status(500).json({ error: "Failed to load summary" });
  }
});

router.get("/lines", requireFinanceAccess, async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const where = status ? eq(finLinesTable.status, status) : undefined;
    const lines = await db
      .select()
      .from(finLinesTable)
      .where(where)
      .orderBy(desc(finLinesTable.lineDate), desc(finLinesTable.id))
      .limit(500);

    const lineIds = lines.map((l) => l.id);
    const docs = lineIds.length
      ? await db
          .select({ id: finDocumentsTable.id, lineId: finDocumentsTable.lineId, fileName: finDocumentsTable.fileName, docKind: finDocumentsTable.docKind, fileMime: finDocumentsTable.fileMime, createdAt: finDocumentsTable.createdAt })
          .from(finDocumentsTable)
          .where(inArray(finDocumentsTable.lineId, lineIds))
      : [];
    const suggestions = lineIds.length
      ? await db
          .select({ lineId: finMatchesTable.lineId, n: sql<number>`count(*)::int` })
          .from(finMatchesTable)
          .where(and(inArray(finMatchesTable.lineId, lineIds), eq(finMatchesTable.state, "suggested")))
          .groupBy(finMatchesTable.lineId)
      : [];
    const vendorIds = [...new Set(lines.map((l) => l.vendorId).filter((v): v is number => v !== null))];
    const vendors = vendorIds.length
      ? await db.select().from(finVendorsTable).where(inArray(finVendorsTable.id, vendorIds))
      : [];

    res.json({
      lines,
      documentsByLine: groupBy(docs, (d) => d.lineId),
      suggestionCounts: Object.fromEntries(suggestions.map((s) => [s.lineId, s.n])),
      vendors: Object.fromEntries(vendors.map((v) => [v.id, v])),
    });
  } catch (err) {
    console.error("[finance] lines error:", err);
    res.status(500).json({ error: "Failed to load lines" });
  }
});

function groupBy<T>(items: T[], key: (t: T) => number): Record<number, T[]> {
  const out: Record<number, T[]> = {};
  for (const item of items) {
    (out[key(item)] ??= []).push(item);
  }
  return out;
}

const lineStatusSchema = z.object({
  status: z.enum(["open", "identified", "matched", "done", "not_needed"]),
  statusNote: z.string().max(2000).optional().nullable(),
});

router.patch("/lines/:id", requireFinanceAccess, validate(lineStatusSchema), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { status, statusNote } = req.body as z.infer<typeof lineStatusSchema>;
    const done = status === "done" || status === "not_needed";
    const [row] = await db
      .update(finLinesTable)
      .set({
        status,
        statusNote: statusNote ?? null,
        doneAt: done ? new Date() : null,
        doneBy: done ? (req.session.userId ?? null) : null,
        updatedAt: new Date(),
      })
      .where(eq(finLinesTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Line not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[finance] line update error:", err);
    res.status(500).json({ error: "Failed to update line" });
  }
});

// ---------------------------------------------------------------------------
// Statement uploads (Capital on Tap CSV)

router.post("/uploads", requireFinanceAccess, upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const text = req.file.buffer.toString("utf8");

    let parsed;
    try {
      parsed = parseCotCsv(text);
    } catch (e: any) {
      res.status(422).json({ error: `Could not read this file: ${e.message}` });
      return;
    }

    const [uploadRow] = await db
      .insert(finStatementUploadsTable)
      .values({
        source: "capital_on_tap",
        fileName: req.file.originalname ?? null,
        rowCount: parsed.rows.length,
        uploadedBy: req.session.userId ?? null,
      })
      .returning();

    let newCount = 0;
    for (const r of parsed.rows) {
      const vendorId = await findOrCreateVendor(r.merchant ?? r.descriptor);
      const inserted = await db
        .insert(finLinesTable)
        .values({
          uploadId: uploadRow.id,
          source: "capital_on_tap",
          lineDate: r.clearanceDate,
          authDate: r.authDate,
          descriptor: r.descriptor,
          merchant: r.merchant,
          amount: r.amount,
          currency: r.currency,
          originalAmount: r.originalAmount,
          originalCurrency: r.originalCurrency,
          cardLast4: r.cardLast4,
          cardholder: r.cardholder,
          vendorId,
          dedupeHash: r.dedupeHash,
        })
        .onConflictDoNothing({ target: finLinesTable.dedupeHash })
        .returning({ id: finLinesTable.id });
      if (inserted.length > 0) newCount++;
    }

    const duplicateCount = parsed.rows.length - newCount;
    await db
      .update(finStatementUploadsTable)
      .set({ newCount, duplicateCount })
      .where(eq(finStatementUploadsTable.id, uploadRow.id));

    // New lines → refresh suggestions in the background; don't block the response.
    refreshSuggestions().catch((e) => console.error("[finance] suggestion refresh failed:", e));

    res.json({ uploadId: uploadRow.id, rows: parsed.rows.length, new: newCount, duplicates: duplicateCount, skippedRepayments: parsed.skippedRepayments });
  } catch (err) {
    console.error("[finance] upload error:", err);
    res.status(500).json({ error: "Failed to process upload" });
  }
});

router.get("/uploads", requireFinanceAccess, async (_req: Request, res: Response) => {
  const uploads = await db.select().from(finStatementUploadsTable).orderBy(desc(finStatementUploadsTable.createdAt)).limit(20);
  res.json(uploads);
});

// ---------------------------------------------------------------------------
// Documents — bytea storage, same-origin serving (never blob: URLs; the CSP
// frame-src 'self' lesson from the planner applies here verbatim).

router.post("/lines/:id/documents", requireFinanceAccess, upload.single("file"), async (req: Request, res: Response) => {
  try {
    const lineId = Number(req.params.id);
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const mime = req.file.mimetype || "application/octet-stream";
    const name = req.file.originalname || "document";
    const ok =
      mime === "application/pdf" ||
      mime.startsWith("image/") ||
      mime === "application/octet-stream" ||
      /\.(pdf|png|jpe?g|heic|webp)$/i.test(name);
    if (!ok) { res.status(415).json({ error: `Unsupported file type: ${mime}` }); return; }

    const [line] = await db.select({ id: finLinesTable.id }).from(finLinesTable).where(eq(finLinesTable.id, lineId));
    if (!line) { res.status(404).json({ error: "Line not found" }); return; }

    const [doc] = await db
      .insert(finDocumentsTable)
      .values({
        lineId,
        fileBlob: req.file.buffer,
        fileMime: mime === "application/octet-stream" && name.toLowerCase().endsWith(".pdf") ? "application/pdf" : mime,
        fileName: name,
        fileSizeBytes: req.file.size,
        sha256: createHash("sha256").update(req.file.buffer).digest("hex"),
        docSource: "manual_upload",
        docKind: typeof req.body.docKind === "string" && req.body.docKind ? req.body.docKind : "other",
        uploadedBy: req.session.userId ?? null,
      })
      .returning({ id: finDocumentsTable.id, fileName: finDocumentsTable.fileName });

    // A document in hand moves an open line forward automatically.
    await db
      .update(finLinesTable)
      .set({ status: "matched", updatedAt: new Date() })
      .where(and(eq(finLinesTable.id, lineId), inArray(finLinesTable.status, ["open", "identified"])));

    res.json(doc);
  } catch (err: any) {
    if (err?.code === "LIMIT_FILE_SIZE") { res.status(413).json({ error: "File too large (15MB max)" }); return; }
    console.error("[finance] document upload error:", err);
    res.status(500).json({ error: "Failed to store document" });
  }
});

router.get("/documents/:id/file", requireFinanceAccess, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [doc] = await db.select().from(finDocumentsTable).where(eq(finDocumentsTable.id, id));
    if (!doc || !doc.fileBlob) { res.status(404).json({ error: "No file" }); return; }
    const buf = Buffer.isBuffer(doc.fileBlob) ? doc.fileBlob : Buffer.from(doc.fileBlob as any);
    const filename = (doc.fileName || "document").replace(/["\r\n]/g, "");
    const disposition = req.query.download === "1" ? "attachment" : "inline";
    res.setHeader("Content-Type", doc.fileMime || "application/octet-stream");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
    // Documents come from arbitrary external senders — sandbox the response.
    res.setHeader("Content-Security-Policy", "sandbox");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(buf);
  } catch (err) {
    console.error("[finance] document download error:", err);
    res.status(500).json({ error: "Failed to download" });
  }
});

// ---------------------------------------------------------------------------
// Match suggestions — bookkeepers see suggestion metadata (sender, subject,
// score) and can confirm/reject; confirming pulls the attachment into the
// document store. Raw index browsing stays admin-only.

router.get("/lines/:id/matches", requireFinanceAccess, async (req: Request, res: Response) => {
  const lineId = Number(req.params.id);
  const matches = await db
    .select({
      id: finMatchesTable.id,
      score: finMatchesTable.score,
      signals: finMatchesTable.signals,
      strength: finMatchesTable.strength,
      reasons: finMatchesTable.reasons,
      state: finMatchesTable.state,
      fromAddress: finEmailIndexTable.fromAddress,
      subject: finEmailIndexTable.subject,
      internalDate: finEmailIndexTable.internalDate,
      hasPdf: finEmailIndexTable.hasPdf,
    })
    .from(finMatchesTable)
    .innerJoin(finEmailIndexTable, eq(finMatchesTable.emailIndexId, finEmailIndexTable.id))
    .where(eq(finMatchesTable.lineId, lineId))
    .orderBy(desc(finMatchesTable.score));
  res.json(matches);
});

router.post("/matches/:id/confirm", requireFinanceAccess, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [match] = await db.select().from(finMatchesTable).where(eq(finMatchesTable.id, id));
    if (!match) { res.status(404).json({ error: "Match not found" }); return; }
    const [emailRow] = await db.select().from(finEmailIndexTable).where(eq(finEmailIndexTable.id, match.emailIndexId));
    if (!emailRow) { res.status(404).json({ error: "Email no longer indexed" }); return; }

    const attachment = await fetchAttachmentForMessage(emailRow.folder, emailRow.imapUid);
    if (!attachment) {
      res.status(502).json({ error: "Could not fetch the email content — try again, or upload the document manually" });
      return;
    }

    const [doc] = await db
      .insert(finDocumentsTable)
      .values({
        lineId: match.lineId,
        fileBlob: attachment.content,
        fileMime: attachment.mime,
        fileName: attachment.fileName,
        fileSizeBytes: attachment.content.length,
        sha256: createHash("sha256").update(attachment.content).digest("hex"),
        docSource: attachment.mime === "application/pdf" ? "imap_attachment" : "email_body_render",
        sourceRef: `${emailRow.folder}:${emailRow.imapUid}`,
        docKind: attachment.mime === "application/pdf" ? "invoice" : "receipt",
        uploadedBy: req.session.userId ?? null,
      })
      .returning({ id: finDocumentsTable.id });

    await db
      .update(finMatchesTable)
      .set({ state: "confirmed", decidedBy: req.session.userId ?? null, decidedAt: new Date() })
      .where(eq(finMatchesTable.id, id));
    await db
      .update(finLinesTable)
      .set({ status: "matched", updatedAt: new Date() })
      .where(and(eq(finLinesTable.id, match.lineId), inArray(finLinesTable.status, ["open", "identified"])));

    res.json({ documentId: doc.id });
  } catch (err) {
    console.error("[finance] confirm match error:", err);
    res.status(500).json({ error: "Failed to confirm match" });
  }
});

router.post("/matches/:id/reject", requireFinanceAccess, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [row] = await db
    .update(finMatchesTable)
    .set({ state: "rejected", decidedBy: req.session.userId ?? null, decidedAt: new Date() })
    .where(eq(finMatchesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Match not found" }); return; }
  res.json(row);
});

// ---------------------------------------------------------------------------
// Vendors (supplier knowledge base)

const vendorPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  website: z.string().max(500).optional().nullable(),
  accountsEmail: z.string().max(320).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  contactName: z.string().max(200).optional().nullable(),
  portalUrl: z.string().max(500).optional().nullable(),
  invoiceBehaviour: z.enum(["emails_pdf", "on_request", "portal", "never", "unknown"]).optional(),
  vatExpectation: z.enum(["standard", "zero", "mixed", "none", "unknown"]).optional(),
  notes: z.string().max(5000).optional().nullable(),
});

router.patch("/vendors/:id", requireFinanceAccess, validate(vendorPatchSchema), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const patch = req.body as z.infer<typeof vendorPatchSchema>;
    const [row] = await db
      .update(finVendorsTable)
      .set({ ...patch, detailsConfirmed: true, updatedAt: new Date() })
      .where(eq(finVendorsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Vendor not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[finance] vendor update error:", err);
    res.status(500).json({ error: "Failed to update vendor" });
  }
});

// ---------------------------------------------------------------------------
// Mailbox settings — ADMIN ONLY. The password is written, never read back.

const mailboxSchema = z.object({
  emailAddress: z.string().email(),
  password: z.string().min(4),
  scanSince: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.put("/mailbox", requireAdmin, validate(mailboxSchema), async (req: Request, res: Response) => {
  try {
    const { emailAddress, password, scanSince } = req.body as z.infer<typeof mailboxSchema>;
    const sealed = sealSecret(password);
    const [existing] = await db.select({ id: finMailboxTable.id }).from(finMailboxTable).limit(1);
    if (existing) {
      await db
        .update(finMailboxTable)
        .set({ emailAddress, passwordEnc: sealed, scanSince: scanSince ?? null, uidState: {}, lastError: null, updatedAt: new Date() })
        .where(eq(finMailboxTable.id, existing.id));
    } else {
      await db.insert(finMailboxTable).values({ emailAddress, passwordEnc: sealed, scanSince: scanSince ?? null });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[finance] mailbox save error:", err);
    res.status(500).json({ error: "Failed to save mailbox settings" });
  }
});

router.get("/mailbox", requireAdmin, async (_req: Request, res: Response) => {
  const [box] = await db
    .select({
      emailAddress: finMailboxTable.emailAddress,
      imapHost: finMailboxTable.imapHost,
      foldersWatched: finMailboxTable.foldersWatched,
      scanSince: finMailboxTable.scanSince,
      lastSyncAt: finMailboxTable.lastSyncAt,
      lastError: finMailboxTable.lastError,
    })
    .from(finMailboxTable)
    .limit(1);
  res.json(box ?? null);
});

const scanRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// One-off ranged scan — reaches back before the configured backfill date
// without touching the incremental cursor.
router.post("/mailbox/scan-range", requireAdmin, validate(scanRangeSchema), async (req: Request, res: Response) => {
  const { from, to } = req.body as z.infer<typeof scanRangeSchema>;
  runMailboxSync({ rangeFrom: from, rangeTo: to })
    .then((o) => {
      if (o.error) console.error("[finance] range scan finished with error:", o.error);
      else console.log(`[finance] range scan done: scanned ${o.scanned}, indexed ${o.indexed}`);
    })
    .catch((err) => console.error("[finance] range scan crashed:", err));
  res.json({ started: true, from, to: to ?? null });
});

router.post("/mailbox/sync", requireAdmin, async (_req: Request, res: Response) => {
  // Fire-and-forget: a first backfill can take many minutes, and holding the
  // HTTP request open that long just times out and invites double-clicks.
  // Progress is visible via GET /mailbox (lastSyncAt / lastError).
  runMailboxSync()
    .then((o) => {
      if (o.error) console.error("[finance] sync finished with error:", o.error);
      else console.log(`[finance] sync done: scanned ${o.scanned}, indexed ${o.indexed}`);
    })
    .catch((err) => console.error("[finance] sync crashed:", err));
  res.json({ started: true });
});

// ---------------------------------------------------------------------------
// QuickBooks (read-only) — ADMIN ONLY. Rules out card lines that are
// already posted. The app never writes to QuickBooks.

router.get("/qbo/status", requireAdmin, async (_req: Request, res: Response) => {
  try {
    res.json(await qboStatus());
  } catch (err) {
    console.error("[finance] qbo status error:", err);
    res.status(500).json({ error: "Failed to load QuickBooks status" });
  }
});

router.get("/qbo/connect", requireAdmin, async (req: Request, res: Response) => {
  if (!qboConfigured()) {
    res.status(503).json({ error: "QuickBooks app credentials not set — add QBO_CLIENT_ID and QBO_CLIENT_SECRET to the environment first." });
    return;
  }
  const state = newStateToken();
  (req.session as any).qboState = state;
  res.redirect(authorizeUrl(state));
});

// Intuit redirects the admin's browser here after they approve access.
router.get("/qbo/callback", async (req: Request, res: Response) => {
  try {
    const { code, realmId, state } = req.query as Record<string, string>;
    const expected = (req.session as any).qboState;
    if (!expected || state !== expected) {
      res.status(400).send("QuickBooks connection failed: state mismatch. Go back to Finance and try Connect again.");
      return;
    }
    if (req.session.userRole !== "admin") {
      res.status(403).send("Admin access required.");
      return;
    }
    if (!code || !realmId) {
      res.status(400).send("QuickBooks did not return an authorisation code.");
      return;
    }
    delete (req.session as any).qboState;
    await exchangeCode(code, realmId);
    // First sync in the background; the admin lands back on Finance.
    runQboSync()
      .then((o) => console.log(`[finance] first QBO sync: ${o.purchases} purchases, ${o.bills} bills, ${o.linesClosed} lines closed${o.error ? ` (error: ${o.error})` : ""}`))
      .catch((e) => console.error("[finance] first QBO sync failed:", e));
    res.redirect("/finance");
  } catch (err) {
    console.error("[finance] qbo callback error:", err);
    res.status(500).send(`QuickBooks connection failed: ${err instanceof Error ? err.message : "unknown error"}. Go back to Finance and try again.`);
  }
});

router.post("/qbo/sync", requireAdmin, async (_req: Request, res: Response) => {
  runQboSync()
    .then((o) => {
      if (o.error) console.error("[finance] QBO sync finished with error:", o.error);
      else console.log(`[finance] QBO sync done: ${o.purchases} purchases, ${o.bills} bills, ${o.linesClosed} lines closed`);
    })
    .catch((err) => console.error("[finance] QBO sync crashed:", err));
  res.json({ started: true });
});

router.delete("/qbo", requireAdmin, async (_req: Request, res: Response) => {
  await dbForQbo.delete(finQboConnectionTable);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Finance access management — ADMIN ONLY. Lives here (not settings.tsx,
// which the charter freezes): grant/revoke the bookkeeper flag.

router.get("/access", requireAdmin, async (_req: Request, res: Response) => {
  const users = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, isBookkeeper: usersTable.isBookkeeper })
    .from(usersTable)
    .where(eq(usersTable.isActive, true));
  res.json(users);
});

const accessSchema = z.object({ isBookkeeper: z.boolean() });

router.patch("/access/:userId", requireAdmin, validate(accessSchema), async (req: Request, res: Response) => {
  const userId = Number(req.params.userId);
  const { isBookkeeper } = req.body as z.infer<typeof accessSchema>;
  const [row] = await db
    .update(usersTable)
    .set({ isBookkeeper, updatedAt: new Date() })
    .where(eq(usersTable.id, userId))
    .returning({ id: usersTable.id, isBookkeeper: usersTable.isBookkeeper });
  if (!row) { res.status(404).json({ error: "User not found" }); return; }
  res.json(row);
});

export default router;
