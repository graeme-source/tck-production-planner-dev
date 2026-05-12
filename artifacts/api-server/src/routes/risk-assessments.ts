import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import {
  db,
  riskAssessmentsTable,
  complianceActionsTable,
  complianceActionCompletionsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, isNull, sql, asc, desc, gte, lte, inArray, ne } from "drizzle-orm";
import { londonDateString } from "../lib/london-time";

const router: IRouter = Router();

// PDF uploads only. Cap at 15MB — typical compliance docs are <1MB; the cap
// is generous for the occasional scanned multi-page certificate.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Columns selected for list/get endpoints — excludes fileBlob so the list
// query doesn't drag every PDF over the wire.
const documentMetaColumns = {
  id: riskAssessmentsTable.id,
  assessmentType: riskAssessmentsTable.assessmentType,
  title: riskAssessmentsTable.title,
  bodyMarkdown: riskAssessmentsTable.bodyMarkdown,
  status: riskAssessmentsTable.status,
  reviewFrequencyMonths: riskAssessmentsTable.reviewFrequencyMonths,
  lastReviewedAt: riskAssessmentsTable.lastReviewedAt,
  nextReviewDue: riskAssessmentsTable.nextReviewDue,
  lastReviewedByUserId: riskAssessmentsTable.lastReviewedByUserId,
  lastReviewedByName: riskAssessmentsTable.lastReviewedByName,
  reviewerQualifications: riskAssessmentsTable.reviewerQualifications,
  fileMime: riskAssessmentsTable.fileMime,
  fileName: riskAssessmentsTable.fileName,
  fileSizeBytes: riskAssessmentsTable.fileSizeBytes,
  fileVersion: riskAssessmentsTable.fileVersion,
  fileUploadedAt: riskAssessmentsTable.fileUploadedAt,
  originalIssueDate: riskAssessmentsTable.originalIssueDate,
  createdAt: riskAssessmentsTable.createdAt,
  updatedAt: riskAssessmentsTable.updatedAt,
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session.userRole === "admin") { next(); return; }
  res.status(403).json({ error: "Admin access required" });
}

const RECURRENCE_DAYS: Record<string, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 91,
  six_monthly: 182,
  annually: 365,
  three_yearly: 365 * 3,
  five_yearly: 365 * 5,
};

function addDaysIso(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function todayIso(): string {
  return londonDateString();
}

async function resolveUserName(userId: number | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  return u?.name ?? null;
}

// ─── Risk Assessments ────────────────────────────────────────────────────────

router.get("/", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select(documentMetaColumns)
      .from(riskAssessmentsTable)
      .orderBy(asc(riskAssessmentsTable.assessmentType), asc(riskAssessmentsTable.title));
    res.json(rows);
  } catch (err) {
    console.error("[risk-assessments] list error:", err);
    res.status(500).json({ error: "Failed to load risk assessments" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [ra] = await db.select(documentMetaColumns).from(riskAssessmentsTable).where(eq(riskAssessmentsTable.id, id));
    if (!ra) { res.status(404).json({ error: "Risk assessment not found" }); return; }
    const actions = await db
      .select()
      .from(complianceActionsTable)
      .where(eq(complianceActionsTable.riskAssessmentId, id))
      .orderBy(asc(complianceActionsTable.status), asc(complianceActionsTable.dueDate));
    res.json({ ...ra, actions });
  } catch (err) {
    console.error("[risk-assessments] get error:", err);
    res.status(500).json({ error: "Failed to load risk assessment" });
  }
});

// ─── File upload / download / removal ────────────────────────────────────────
//
// PDFs are stored inline as bytea on the risk_assessments row (~200KB–1MB
// each, capped at 15MB). Upload replaces any existing file. Download streams
// the bytes back with the stored filename and mime.

router.post(
  "/:id/file",
  requireAdmin,
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }
      // Be permissive on mime — Safari sometimes posts application/octet-stream
      // for PDFs. Reject anything that's clearly not a document.
      const mime = req.file.mimetype || "application/octet-stream";
      const looksLikePdf =
        mime === "application/pdf" ||
        mime === "application/octet-stream" ||
        (req.file.originalname || "").toLowerCase().endsWith(".pdf");
      if (!looksLikePdf) {
        res.status(415).json({ error: `Unsupported file type: ${mime}. PDF only.` });
        return;
      }
      const fileVersion = typeof req.body.fileVersion === "string" && req.body.fileVersion.trim()
        ? String(req.body.fileVersion).trim()
        : null;
      const [row] = await db
        .update(riskAssessmentsTable)
        .set({
          fileBlob: req.file.buffer,
          fileMime: "application/pdf",
          fileName: req.file.originalname || "document.pdf",
          fileSizeBytes: req.file.size,
          fileVersion: fileVersion ?? undefined,
          fileUploadedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(riskAssessmentsTable.id, id))
        .returning(documentMetaColumns);
      if (!row) {
        res.status(404).json({ error: "Risk assessment not found" });
        return;
      }
      res.json(row);
    } catch (err: any) {
      if (err?.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "File too large (15MB max)" });
        return;
      }
      console.error("[risk-assessments] upload error:", err);
      res.status(500).json({ error: "Failed to upload file" });
    }
  },
);

router.get("/:id/file", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [row] = await db
      .select({
        fileBlob: riskAssessmentsTable.fileBlob,
        fileMime: riskAssessmentsTable.fileMime,
        fileName: riskAssessmentsTable.fileName,
        fileSizeBytes: riskAssessmentsTable.fileSizeBytes,
      })
      .from(riskAssessmentsTable)
      .where(eq(riskAssessmentsTable.id, id));
    if (!row || !row.fileBlob) {
      res.status(404).json({ error: "No file attached" });
      return;
    }
    const buf = Buffer.isBuffer(row.fileBlob) ? row.fileBlob : Buffer.from(row.fileBlob as any);
    const filename = (row.fileName || "document.pdf").replace(/"/g, "");
    const disposition = req.query.download === "1" ? "attachment" : "inline";
    res.setHeader("Content-Type", row.fileMime || "application/pdf");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
    res.end(buf);
  } catch (err) {
    console.error("[risk-assessments] download error:", err);
    res.status(500).json({ error: "Failed to download file" });
  }
});

router.delete("/:id/file", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [row] = await db
      .update(riskAssessmentsTable)
      .set({
        fileBlob: null as any,
        fileMime: null,
        fileName: null,
        fileSizeBytes: null,
        fileVersion: null,
        fileUploadedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(riskAssessmentsTable.id, id))
      .returning(documentMetaColumns);
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    console.error("[risk-assessments] file delete error:", err);
    res.status(500).json({ error: "Failed to remove file" });
  }
});

router.post("/", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { assessmentType, title, bodyMarkdown, status, reviewFrequencyMonths, originalIssueDate, fileVersion } = req.body;
    if (!assessmentType || !title) {
      res.status(400).json({ error: "assessmentType and title are required" });
      return;
    }
    const [row] = await db
      .insert(riskAssessmentsTable)
      .values({
        assessmentType: String(assessmentType),
        title: String(title),
        bodyMarkdown: bodyMarkdown ?? "",
        status: status ?? "draft",
        reviewFrequencyMonths: reviewFrequencyMonths ?? 12,
        originalIssueDate: originalIssueDate ?? null,
        fileVersion: fileVersion ?? null,
      })
      .returning(documentMetaColumns);
    res.status(201).json(row);
  } catch (err) {
    console.error("[risk-assessments] create error:", err);
    res.status(500).json({ error: "Failed to create risk assessment" });
  }
});

router.patch("/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { title, bodyMarkdown, status, reviewFrequencyMonths, assessmentType, originalIssueDate, fileVersion } = req.body;
    const updates: Partial<typeof riskAssessmentsTable.$inferInsert> = { updatedAt: new Date() };
    if (title !== undefined) updates.title = String(title);
    if (bodyMarkdown !== undefined) updates.bodyMarkdown = String(bodyMarkdown);
    if (status !== undefined) updates.status = String(status);
    if (assessmentType !== undefined) updates.assessmentType = String(assessmentType);
    if (reviewFrequencyMonths !== undefined) updates.reviewFrequencyMonths = Number(reviewFrequencyMonths);
    if (originalIssueDate !== undefined) updates.originalIssueDate = originalIssueDate || null;
    if (fileVersion !== undefined) updates.fileVersion = fileVersion || null;
    const [row] = await db.update(riskAssessmentsTable).set(updates).where(eq(riskAssessmentsTable.id, id)).returning(documentMetaColumns);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[risk-assessments] update error:", err);
    res.status(500).json({ error: "Failed to update risk assessment" });
  }
});

// POST /:id/review — record that a review has been performed
router.post("/:id/review", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { reviewerName, reviewerQualifications } = req.body;
    const [current] = await db.select().from(riskAssessmentsTable).where(eq(riskAssessmentsTable.id, id));
    if (!current) { res.status(404).json({ error: "Not found" }); return; }
    const userId = req.session.userId ?? null;
    const name = reviewerName ?? (await resolveUserName(userId)) ?? "Unknown";
    const now = new Date();
    const nextDue = new Date(now);
    nextDue.setMonth(nextDue.getMonth() + (current.reviewFrequencyMonths ?? 12));
    const [row] = await db.update(riskAssessmentsTable).set({
      lastReviewedAt: now,
      lastReviewedByUserId: userId,
      lastReviewedByName: String(name),
      reviewerQualifications: reviewerQualifications ? String(reviewerQualifications) : null,
      nextReviewDue: nextDue.toISOString().slice(0, 10),
      updatedAt: now,
    }).where(eq(riskAssessmentsTable.id, id)).returning();
    res.json(row);
  } catch (err) {
    console.error("[risk-assessments] review error:", err);
    res.status(500).json({ error: "Failed to record review" });
  }
});

router.delete("/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await db.delete(riskAssessmentsTable).where(eq(riskAssessmentsTable.id, id));
    res.status(204).end();
  } catch (err) {
    console.error("[risk-assessments] delete error:", err);
    res.status(500).json({ error: "Failed to delete risk assessment" });
  }
});

export default router;
