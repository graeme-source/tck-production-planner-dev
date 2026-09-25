/**
 * Old contracts filed on a person's record (Graeme, 2026-09-25: "upload a
 * contract manually into someone's employee record, an old PDF that we
 * created at the start of their employment ... then we'll create new
 * contracts from the data in that").
 *
 *   GET    /api/contracts/uploaded/can-manage      { canManage } for the signed-in person
 *   GET    /api/contracts/uploaded/mine            MY uploaded contracts (session only, no user param)
 *   GET    /api/contracts/uploaded/person/:userId  HR: one person's contract history —
 *                                                  issued-in-app + uploaded
 *   POST   /api/contracts/uploaded                 HR: file one (multipart: file, userId,
 *                                                  originalIssueDate?, notes?)
 *   GET    /api/contracts/uploaded/:id             owner or HR (404 otherwise)
 *   GET    /api/contracts/uploaded/:id/file        the document itself, inline (?download=1)
 *   PATCH  /api/contracts/uploaded/:id             HR: issue date, notes, confirmed prefill
 *   DELETE /api/contracts/uploaded/:id             HR: remove one filed by mistake
 *   POST   /api/contracts/uploaded/:id/extract     HR: read it with Claude → confirm card
 *
 * Mounted ahead of /api/contracts so "/uploaded" never reaches that router's
 * "/:id". Stored in uploaded_contracts (migration 0130), NOT
 * employment_contracts: an uploaded file was never issued or signed in the
 * app, and must never look as if it had been — nor touch the signed-contract
 * triggers.
 *
 * Privacy (rules + tests: lib/uploaded-contract-access.ts): pay is on these,
 * so it's the contract rule — HR-records accounts (the founder today) and
 * the employee themself, nobody else. People access alone grants nothing
 * here. A by-id read that isn't yours answers 404, never 403.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import * as z from "zod";
import { db, uploadedContractsTable, employmentContractsTable, usersTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { validate, validateQuery } from "../middleware/validate";
import { singleFileUpload } from "../middleware/upload";
import { hasHrRecordAccess } from "../middleware/hr-access";
import {
  uploadedContractAccess, isAllowedContractFile, UPLOADED_CONTRACT_MAX_MB,
} from "../lib/uploaded-contract-access";
import { prefillFromExtraction, type ContractExtraction } from "../lib/contract-extraction";
import { readContractDocument } from "../services/contract-reader";

const router: IRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Everything except the bytes — those only leave through /:id/file.
const META = {
  id: uploadedContractsTable.id,
  userId: uploadedContractsTable.userId,
  fileName: uploadedContractsTable.fileName,
  mime: uploadedContractsTable.mime,
  byteSize: uploadedContractsTable.byteSize,
  originalIssueDate: uploadedContractsTable.originalIssueDate,
  notes: uploadedContractsTable.notes,
  uploadedByName: uploadedContractsTable.uploadedByName,
  uploadedAt: uploadedContractsTable.uploadedAt,
  extractedAt: uploadedContractsTable.extractedAt,
  extraction: uploadedContractsTable.extraction,
  prefill: uploadedContractsTable.prefill,
} as const;

type MetaRow = {
  id: number; userId: number; fileName: string | null; mime: string; byteSize: number;
  originalIssueDate: string | null; notes: string | null; uploadedByName: string | null;
  uploadedAt: Date; extractedAt: Date | null; extraction: unknown; prefill: unknown;
};

/** The HR view: everything. */
function shapeForHr(r: MetaRow) {
  return {
    id: r.id, userId: r.userId, fileName: r.fileName, mime: r.mime, byteSize: r.byteSize,
    originalIssueDate: r.originalIssueDate, notes: r.notes, uploadedByName: r.uploadedByName,
    uploadedAt: r.uploadedAt, extractedAt: r.extractedAt,
    extraction: (r.extraction ?? null) as ContractExtraction | null,
    prefill: r.prefill ?? null,
  };
}

/** The employee's own view: the document and its date — not the founder's
 *  notes, the AI read, or the draft values for a new contract. */
function shapeForOwner(r: MetaRow) {
  return {
    id: r.id, userId: r.userId, fileName: r.fileName, mime: r.mime, byteSize: r.byteSize,
    originalIssueDate: r.originalIssueDate, uploadedAt: r.uploadedAt,
  };
}

async function viewerOf(req: Request) {
  return { viewerId: req.session.userId ?? null, viewerIsHr: await hasHrRecordAccess(req) };
}

async function requireHr(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    if (!(await hasHrRecordAccess(req))) { res.status(403).json({ error: "Founder only" }); return; }
    next();
  } catch (err) {
    console.error("[uploaded-contracts] HR check failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Internal server error" });
  }
}

function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Load a row the viewer may see, or answer 404 and return null. */
async function loadVisible(req: Request, res: Response) {
  const id = parseId(req.params["id"]);
  if (id == null) { res.status(404).json({ error: "No such contract" }); return null; }
  const [row] = await db.select(META).from(uploadedContractsTable).where(eq(uploadedContractsTable.id, id));
  const viewer = await viewerOf(req);
  const access = row ? uploadedContractAccess(viewer, row.userId) : "none";
  if (!row || access === "none") { res.status(404).json({ error: "No such contract" }); return null; }
  return { row: row as MetaRow, access };
}

// ── Who am I here ──────────────────────────────────────────────────────────

router.get("/can-manage", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  res.json({ canManage: await hasHrRecordAccess(req) });
});

// ── Employee: mine ─────────────────────────────────────────────────────────

// Takes NO user parameter: the session is the only selector.
router.get("/mine", async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const rows = await db.select(META).from(uploadedContractsTable)
    .where(eq(uploadedContractsTable.userId, userId))
    .orderBy(desc(uploadedContractsTable.originalIssueDate), desc(uploadedContractsTable.uploadedAt));
  res.json(rows.map(r => shapeForOwner(r as MetaRow)));
});

// ── HR: one person's whole contract history ────────────────────────────────

router.get("/person/:userId", requireHr, async (req: Request, res: Response) => {
  const userId = parseId(req.params["userId"]);
  if (userId == null) { res.status(400).json({ error: "Invalid person" }); return; }
  const [person] = await db.select({ id: usersTable.id, name: usersTable.name, jobTitle: usersTable.jobTitle })
    .from(usersTable).where(eq(usersTable.id, userId));
  if (!person) { res.status(404).json({ error: "Not found" }); return; }
  const [issued, uploaded] = await Promise.all([
    db.select({
      id: employmentContractsTable.id,
      jobTitle: employmentContractsTable.jobTitle,
      rateOfPay: employmentContractsTable.rateOfPay,
      weeklyHours: employmentContractsTable.weeklyHours,
      startDate: employmentContractsTable.startDate,
      issueDate: employmentContractsTable.issueDate,
      issuedAt: employmentContractsTable.issuedAt,
      acknowledgedAt: employmentContractsTable.acknowledgedAt,
      signedInitials: employmentContractsTable.signedInitials,
    }).from(employmentContractsTable)
      .where(eq(employmentContractsTable.userId, userId))
      .orderBy(desc(employmentContractsTable.issuedAt)),
    db.select(META).from(uploadedContractsTable)
      .where(eq(uploadedContractsTable.userId, userId))
      .orderBy(desc(uploadedContractsTable.originalIssueDate), desc(uploadedContractsTable.uploadedAt)),
  ]);
  res.json({ person, issued, uploaded: uploaded.map(r => shapeForHr(r as MetaRow)) });
});

// ── HR: file one ───────────────────────────────────────────────────────────

const UploadFields = z.object({
  userId: z.coerce.number().int().positive(),
  originalIssueDate: z.union([z.literal(""), z.string().regex(DATE_RE, "Issue date must be YYYY-MM-DD")]).optional(),
  notes: z.string().max(2000).optional(),
});

router.post(
  "/",
  requireHr,
  singleFileUpload("file", UPLOADED_CONTRACT_MAX_MB),
  validate(UploadFields),
  async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof UploadFields>;
    if (!req.file) { res.status(400).json({ error: "Choose the contract file first." }); return; }
    if (!isAllowedContractFile(req.file.mimetype)) {
      res.status(400).json({ error: "PDFs and photos only (PDF, JPEG, PNG or WebP)." });
      return;
    }
    const [person] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, body.userId));
    if (!person) { res.status(400).json({ error: "No such person" }); return; }
    const [me] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.session.userId!));

    const [row] = await db.insert(uploadedContractsTable).values({
      userId: body.userId,
      fileName: req.file.originalname ? req.file.originalname.slice(0, 200) : null,
      mime: req.file.mimetype,
      data: req.file.buffer,
      byteSize: req.file.size,
      originalIssueDate: body.originalIssueDate ? body.originalIssueDate : null,
      notes: body.notes?.trim() ? body.notes.trim() : null,
      uploadedByUserId: req.session.userId ?? null,
      uploadedByName: me?.name ?? null,
    }).returning(META);
    res.status(201).json(shapeForHr(row as MetaRow));
  },
);

// ── Read one ───────────────────────────────────────────────────────────────

router.get("/:id", async (req: Request, res: Response) => {
  const found = await loadVisible(req, res);
  if (!found) return;
  res.json(found.access === "manage" ? shapeForHr(found.row) : shapeForOwner(found.row));
});

const FileQuery = z.object({ download: z.enum(["0", "1"]).optional() });

router.get("/:id/file", validateQuery(FileQuery), async (req: Request, res: Response) => {
  const found = await loadVisible(req, res);
  if (!found) return;
  const [file] = await db.select({ data: uploadedContractsTable.data }).from(uploadedContractsTable)
    .where(eq(uploadedContractsTable.id, found.row.id));
  if (!file) { res.status(404).json({ error: "No such contract" }); return; }
  const { download } = res.locals["query"] as z.infer<typeof FileQuery>;
  const ext = found.row.mime === "application/pdf" ? "pdf" : found.row.mime.split("/")[1] ?? "bin";
  const safeName = (found.row.fileName ?? `previous-contract.${ext}`).replace(/[^\w.\- ]+/g, "_");
  res.setHeader("Content-Type", found.row.mime);
  res.setHeader("Content-Disposition", `${download === "1" ? "attachment" : "inline"}; filename="${safeName}"`);
  // Pay is on it: never let a shared iPad's cache keep a copy.
  res.setHeader("Cache-Control", "private, no-store");
  res.send(file.data);
});

// ── HR: edit / remove ──────────────────────────────────────────────────────

const shortText = (max: number) => z.string().max(max).nullable();

const PatchBody = z.object({
  originalIssueDate: z.union([z.string().regex(DATE_RE, "Issue date must be YYYY-MM-DD"), z.null()]).optional(),
  notes: shortText(2000).optional(),
  prefill: z.object({
    jobTitle: shortText(200),
    rateOfPay: shortText(50),
    weeklyHours: shortText(50),
    startDate: z.union([z.string().regex(DATE_RE, "Start date must be YYYY-MM-DD"), z.literal(""), z.null()]),
  }).nullable().optional(),
});

router.patch("/:id", requireHr, validate(PatchBody), async (req: Request, res: Response) => {
  const found = await loadVisible(req, res);
  if (!found) return;
  const body = req.body as z.infer<typeof PatchBody>;
  const blank = (s: string | null | undefined) => (s == null || s.trim() === "" ? null : s.trim());
  const [row] = await db.update(uploadedContractsTable).set({
    ...(body.originalIssueDate !== undefined ? { originalIssueDate: body.originalIssueDate } : {}),
    ...(body.notes !== undefined ? { notes: blank(body.notes) } : {}),
    ...(body.prefill !== undefined ? {
      prefill: body.prefill == null ? null : {
        jobTitle: blank(body.prefill.jobTitle),
        rateOfPay: blank(body.prefill.rateOfPay),
        weeklyHours: blank(body.prefill.weeklyHours),
        startDate: blank(body.prefill.startDate),
      },
    } : {}),
    updatedAt: new Date(),
  }).where(eq(uploadedContractsTable.id, found.row.id)).returning(META);
  res.json(shapeForHr(row as MetaRow));
});

router.delete("/:id", requireHr, async (req: Request, res: Response) => {
  const found = await loadVisible(req, res);
  if (!found) return;
  await db.delete(uploadedContractsTable).where(eq(uploadedContractsTable.id, found.row.id));
  res.json({ ok: true });
});

// ── HR: read it with Claude ────────────────────────────────────────────────

const ExtractBody = z.object({});

router.post("/:id/extract", requireHr, validate(ExtractBody), async (req: Request, res: Response) => {
  const found = await loadVisible(req, res);
  if (!found) return;
  const [file] = await db.select({ data: uploadedContractsTable.data }).from(uploadedContractsTable)
    .where(eq(uploadedContractsTable.id, found.row.id));
  const [person] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, found.row.userId));
  if (!file) { res.status(404).json({ error: "No such contract" }); return; }

  const out = await readContractDocument({ mime: found.row.mime, data: file.data }, person?.name ?? null);
  if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }

  // Keep the read. The confirm card's values start from it the first time;
  // after that they're the founder's (autosaved), and a re-read doesn't
  // overwrite corrections. The document's own date fills a blank issue date.
  const prefill = found.row.prefill ?? prefillFromExtraction(out.extraction);
  const issueDate = found.row.originalIssueDate ?? out.extraction.fields.issueDate.value;
  const [row] = await db.update(uploadedContractsTable).set({
    extraction: out.extraction,
    extractedAt: new Date(),
    prefill,
    originalIssueDate: issueDate,
    updatedAt: new Date(),
  }).where(eq(uploadedContractsTable.id, found.row.id)).returning(META);
  res.json(shapeForHr(row as MetaRow));
});

export default router;
