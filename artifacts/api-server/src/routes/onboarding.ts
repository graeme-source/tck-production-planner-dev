// New-starter onboarding — pre-arrival info a colleague provides after accepting
// their invite. Self routes (/me) act on the logged-in user's own record; the
// admin-view routes are gated to managers/admins. Files (right-to-work / food
// hygiene) are stored inline as bytea, mirroring the documents repository.

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { db, usersTable, onboardingSubmissionsTable, onboardingDocumentsTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";

const router: IRouter = Router();

// pdf / jpg / png, capped at 15MB (same cap as the documents repository).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const DOC_KINDS = ["right_to_work", "food_hygiene", "other"] as const;

async function isManagerOrAdmin(req: Request): Promise<boolean> {
  if (req.session.userRole === "admin" || req.session.userRole === "manager") return true;
  if (req.session.userId && !req.session.userRole) {
    const [u] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (u) {
      req.session.userRole = u.role as "admin" | "manager" | "viewer";
      return u.role === "admin" || u.role === "manager";
    }
  }
  return false;
}

async function requireManagerOrAdmin(req: Request, res: Response, next: NextFunction) {
  if (await isManagerOrAdmin(req)) { next(); return; }
  res.status(403).json({ error: "Manager access required" });
}

const docMetaColumns = {
  id: onboardingDocumentsTable.id,
  userId: onboardingDocumentsTable.userId,
  kind: onboardingDocumentsTable.kind,
  fileName: onboardingDocumentsTable.fileName,
  fileMime: onboardingDocumentsTable.fileMime,
  fileSizeBytes: onboardingDocumentsTable.fileSizeBytes,
  uploadedAt: onboardingDocumentsTable.uploadedAt,
} as const;

async function loadOnboarding(userId: number) {
  const [submission] = await db.select().from(onboardingSubmissionsTable).where(eq(onboardingSubmissionsTable.userId, userId));
  const documents = await db.select(docMetaColumns).from(onboardingDocumentsTable)
    .where(eq(onboardingDocumentsTable.userId, userId))
    .orderBy(asc(onboardingDocumentsTable.uploadedAt));
  return { submission: submission ?? null, documents };
}

// ─── Self (the logged-in user's own record) ──────────────────────────────────

// GET /me — current user's submission + document metadata (no blobs).
router.get("/me", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    res.json(await loadOnboarding(userId));
  } catch (err) {
    console.error("[onboarding] get me failed:", err);
    res.status(500).json({ error: "Failed to load onboarding" });
  }
});

// PUT /me — upsert text fields and mark onboarding complete.
router.put("/me", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const str = (v: unknown) => (v != null && String(v).trim() ? String(v).trim() : null);
    const values = {
      phone: str(req.body?.phone),
      address: str(req.body?.address),
      emergencyContactName: str(req.body?.emergencyContactName),
      emergencyContactPhone: str(req.body?.emergencyContactPhone),
      emergencyContactRelationship: str(req.body?.emergencyContactRelationship),
    };

    await db
      .insert(onboardingSubmissionsTable)
      .values({ userId, ...values, submittedAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: onboardingSubmissionsTable.userId,
        set: { ...values, submittedAt: new Date(), updatedAt: new Date() },
      });

    await db.update(usersTable)
      .set({ onboardingCompletedAt: new Date(), onboardingRequired: false, updatedAt: new Date() })
      .where(eq(usersTable.id, userId));

    res.json(await loadOnboarding(userId));
  } catch (err) {
    console.error("[onboarding] save me failed:", err);
    res.status(500).json({ error: "Failed to save onboarding" });
  }
});

// POST /me/documents — upload one file (field "file", body "kind").
router.post("/me/documents", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const kind = DOC_KINDS.includes(req.body?.kind) ? req.body.kind : "other";

    const mime = req.file.mimetype || "application/octet-stream";
    const name = (req.file.originalname || "").toLowerCase();
    const allowed = ["application/pdf", "image/jpeg", "image/png", "application/octet-stream"].includes(mime)
      || /\.(pdf|jpe?g|png)$/.test(name);
    if (!allowed) { res.status(415).json({ error: `Unsupported file type: ${mime}. PDF, JPG or PNG only.` }); return; }

    const [row] = await db.insert(onboardingDocumentsTable).values({
      userId,
      kind,
      fileBlob: req.file.buffer,
      fileMime: mime === "application/octet-stream" ? "application/pdf" : mime,
      fileName: req.file.originalname || "document",
      fileSizeBytes: req.file.size,
      uploadedAt: new Date(),
    }).returning(docMetaColumns);
    res.status(201).json(row);
  } catch (err: any) {
    if (err?.code === "LIMIT_FILE_SIZE") { res.status(413).json({ error: "File too large (15MB max)" }); return; }
    console.error("[onboarding] upload failed:", err);
    res.status(500).json({ error: "Failed to upload document" });
  }
});

// DELETE /me/documents/:id — remove one of your own uploads.
router.delete("/me/documents/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const del = await db.delete(onboardingDocumentsTable)
      .where(and(eq(onboardingDocumentsTable.id, id), eq(onboardingDocumentsTable.userId, req.session.userId!)))
      .returning({ id: onboardingDocumentsTable.id });
    if (del.length === 0) { res.status(404).json({ error: "Document not found" }); return; }
    res.status(204).send();
  } catch (err) {
    console.error("[onboarding] delete document failed:", err);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// GET /documents/:id/file — stream a file. Owner OR manager/admin only.
router.get("/documents/:id/file", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(onboardingDocumentsTable).where(eq(onboardingDocumentsTable.id, id));
    if (!row || !row.fileBlob) { res.status(404).json({ error: "No file" }); return; }
    const isOwner = row.userId === req.session.userId;
    if (!isOwner && !(await isManagerOrAdmin(req))) { res.status(403).json({ error: "Forbidden" }); return; }

    const buf = Buffer.isBuffer(row.fileBlob) ? row.fileBlob : Buffer.from(row.fileBlob as any);
    const filename = (row.fileName || "document").replace(/"/g, "");
    const disposition = req.query.download === "1" ? "attachment" : "inline";
    res.setHeader("Content-Type", row.fileMime || "application/octet-stream");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
    res.end(buf);
  } catch (err) {
    console.error("[onboarding] download failed:", err);
    res.status(500).json({ error: "Failed to download document" });
  }
});

// GET /:userId — admin/manager view of a colleague's onboarding (for matrix reconciliation).
router.get("/:userId", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    res.json(await loadOnboarding(userId));
  } catch (err) {
    console.error("[onboarding] admin get failed:", err);
    res.status(500).json({ error: "Failed to load onboarding" });
  }
});

export default router;
