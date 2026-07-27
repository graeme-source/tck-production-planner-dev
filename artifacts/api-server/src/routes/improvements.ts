import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { db, improvementSubmissionsTable, improvementCommentsTable, usersTable } from "@workspace/db";
import { eq, desc, asc, sql } from "drizzle-orm";
import type { ImprovementSubmission } from "@workspace/db";

const router: IRouter = Router();

// One file per upload. 100MB cap covers short demo clips; images are checked
// against a tighter 10MB limit after the fact. Stored in Postgres as bytea
// (same approach as SOP step media) so no object storage is needed.
const mediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime", "video/ogg"];

router.get("/", async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(improvementSubmissionsTable)
      .orderBy(desc(improvementSubmissionsTable.createdAt));
    res.json(rows);
  } catch (err) {
    console.error("Error fetching improvement submissions:", err);
    res.status(500).json({ error: "Failed to fetch improvement submissions" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { title, description, station, type, reportContext } = req.body;
    if (!title || !description || !station) {
      res.status(400).json({ error: "title, description, and station are required" });
      return;
    }

    const submissionType = type === "struggle" ? "struggle" : "improvement";

    const userId = req.session.userId;
    let submittedByName: string | null = null;
    if (userId) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      submittedByName = user?.name ?? null;
    }

    const [row] = await db
      .insert(improvementSubmissionsTable)
      .values({
        title,
        description,
        station,
        type: submissionType,
        submittedBy: userId ?? null,
        submittedByName,
        // New submissions start assigned to whoever raised them; managers
        // can reassign from the Improvements table.
        assignedTo: userId ?? null,
        assignedToName: submittedByName,
        reportContext: reportContext || null,
      })
      .returning();

    res.status(201).json(row);
  } catch (err) {
    console.error("Error creating improvement submission:", err);
    res.status(500).json({ error: "Failed to create improvement submission" });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  const role = req.session.userRole;
  if (role !== "admin" && role !== "manager") {
    res.status(403).json({ error: "Manager or admin access required" });
    return;
  }

  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const { approvalTier, progressStatus, notes, title, description, assignedTo } = req.body;

    type UpdatePayload = Partial<Pick<ImprovementSubmission, "approvalTier" | "progressStatus" | "notes" | "title" | "description" | "assignedTo" | "assignedToName" | "updatedAt">>;
    const updates: UpdatePayload = { updatedAt: new Date() };
    if (approvalTier !== undefined) updates.approvalTier = approvalTier;
    if (progressStatus !== undefined) {
      // Two-status model: anything that isn't complete is simply submitted.
      updates.progressStatus = progressStatus === "complete" ? "complete" : "submitted_for_review";
    }
    if (notes !== undefined) updates.notes = notes;
    if (title !== undefined) {
      if (!String(title).trim()) { res.status(400).json({ error: "title cannot be empty" }); return; }
      updates.title = String(title).trim();
    }
    if (description !== undefined) {
      if (!String(description).trim()) { res.status(400).json({ error: "description cannot be empty" }); return; }
      updates.description = String(description).trim();
    }
    if (assignedTo !== undefined) {
      if (assignedTo === null || assignedTo === "") {
        updates.assignedTo = null;
        updates.assignedToName = null;
      } else {
        const assigneeId = parseInt(String(assignedTo), 10);
        if (isNaN(assigneeId)) { res.status(400).json({ error: "Invalid assignedTo" }); return; }
        const [assignee] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, assigneeId));
        if (!assignee) { res.status(400).json({ error: "Assignee not found" }); return; }
        updates.assignedTo = assigneeId;
        updates.assignedToName = assignee.name;
      }
    }

    const [row] = await db
      .update(improvementSubmissionsTable)
      .set(updates)
      .where(eq(improvementSubmissionsTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json(row);
  } catch (err) {
    console.error("Error updating improvement submission:", err);
    res.status(500).json({ error: "Failed to update improvement submission" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  const role = req.session.userRole;
  if (role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [row] = await db
      .delete(improvementSubmissionsTable)
      .where(eq(improvementSubmissionsTable.id, id))
      .returning({ id: improvementSubmissionsTable.id });

    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    console.error("Error deleting improvement submission:", err);
    res.status(500).json({ error: "Failed to delete improvement submission" });
  }
});

// Comments
router.get("/:id/comments", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const rows = await db
      .select()
      .from(improvementCommentsTable)
      .where(eq(improvementCommentsTable.improvementId, id))
      .orderBy(asc(improvementCommentsTable.createdAt));
    res.json(rows);
  } catch (err) {
    console.error("Error fetching comments:", err);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

router.post("/:id/comments", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { comment } = req.body;
    if (!comment || !comment.trim()) { res.status(400).json({ error: "comment is required" }); return; }

    const userId = req.session.userId;
    let userName: string | null = null;
    if (userId) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      userName = user?.name ?? null;
    }

    const [row] = await db
      .insert(improvementCommentsTable)
      .values({ improvementId: id, userId: userId ?? null, userName, comment: comment.trim() })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("Error creating comment:", err);
    res.status(500).json({ error: "Failed to create comment" });
  }
});

// ── Attachments (photos & videos) ────────────────────────────────────────

interface AttachmentRow { id: number; kind: string; mime: string; file_name: string | null; created_at: Date | string; }
const toRows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

// List attachment metadata for an improvement (no bytes).
router.get("/:id/attachments", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = toRows<AttachmentRow>(await db.execute(sql`
    SELECT id, kind, mime, file_name, created_at
    FROM improvement_attachments WHERE improvement_id = ${id} ORDER BY created_at ASC
  `));
  res.json(rows.map(a => ({
    id: a.id, kind: a.kind, mime: a.mime, fileName: a.file_name,
    createdAt: a.created_at instanceof Date ? a.created_at.toISOString() : a.created_at,
  })));
});

// Upload a photo or video to an improvement.
router.post("/:id/attachments", mediaUpload.single("file"), async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  const mime = req.file.mimetype;
  const isImage = IMAGE_MIMES.includes(mime);
  const isVideo = VIDEO_MIMES.includes(mime);
  if (!isImage && !isVideo) {
    res.status(400).json({ error: "Unsupported file type. Use JPEG/PNG/WebP/GIF or MP4/WebM/MOV/OGG." });
    return;
  }
  if (isImage && req.file.size > 10 * 1024 * 1024) {
    res.status(400).json({ error: "Image too large (max 10MB)." });
    return;
  }
  const exists = toRows<{ id: number }>(await db.execute(sql`SELECT id FROM improvement_submissions WHERE id = ${id}`));
  if (exists.length === 0) { res.status(404).json({ error: "Improvement not found" }); return; }
  const rows = toRows<{ id: number }>(await db.execute(sql`
    INSERT INTO improvement_attachments (improvement_id, kind, mime, data, file_name)
    VALUES (${id}, ${isImage ? "image" : "video"}, ${mime}, ${req.file.buffer}, ${req.file.originalname ?? null})
    RETURNING id
  `));
  res.status(201).json({ id: rows[0]?.id, kind: isImage ? "image" : "video", mime });
});

// Stream the bytes of a single attachment.
router.get("/attachments/:attId", async (req: Request, res: Response) => {
  const attId = parseInt(String(req.params.attId), 10);
  if (isNaN(attId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = toRows<{ mime: string; data: Buffer; kind: string }>(await db.execute(sql`
    SELECT mime, data, kind FROM improvement_attachments WHERE id = ${attId}
  `));
  const row = rows[0];
  if (!row || !row.data || !row.mime) { res.status(404).json({ error: "Not found" }); return; }
  res.setHeader("Content-Type", row.mime);
  res.setHeader("Cache-Control", "private, max-age=300");
  if (row.kind === "video") res.setHeader("Accept-Ranges", "bytes");
  res.send(row.data);
});

// Delete an attachment (manager/admin).
router.delete("/attachments/:attId", async (req: Request, res: Response) => {
  const role = req.session.userRole;
  if (role !== "admin" && role !== "manager") { res.status(403).json({ error: "Manager or admin access required" }); return; }
  const attId = parseInt(String(req.params.attId), 10);
  if (isNaN(attId)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.execute(sql`DELETE FROM improvement_attachments WHERE id = ${attId}`);
  res.json({ ok: true });
});

export default router;
