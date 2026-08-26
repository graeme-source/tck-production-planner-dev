import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import {
  db, improvementSubmissionsTable, improvementCommentsTable, usersTable,
  stageOf, STAGE_LABEL, canMarkDone, markDoneBlocker, canReview,
} from "@workspace/db";
import { eq, desc, asc, sql } from "drizzle-orm";
import type { ImprovementSubmission } from "@workspace/db";

const router: IRouter = Router();

// One file per upload. 100MB cap covers short demo clips; images are checked
// against a tighter 10MB limit after the fact. Stored in Postgres as bytea
// (same approach as SOP step media) so no object storage is needed.
const mediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime", "video/ogg"];

/** Attachment counts for a set of improvements, in one query — the media
 *  rule needs them on every list, and N+1 on a kitchen iPad is not free. */
async function attachmentCounts(ids: number[]): Promise<Map<number, number>> {
  if (ids.length === 0) return new Map();
  const result = await db.execute<{ improvement_id: number; n: number }>(sql`
    SELECT improvement_id, COUNT(*)::int AS n
      FROM improvement_attachments
     WHERE improvement_id = ANY(${ids})
     GROUP BY improvement_id
  `);
  return new Map((result.rows ?? []).map(r => [Number(r.improvement_id), Number(r.n)]));
}

/**
 * Decorate a stored row with everything the screen needs to render it
 * without knowing any of the rules: which stage it's in, what that's
 * called, and whether this particular viewer may act on it.
 */
function decorate(
  row: ImprovementSubmission,
  mediaCount: number,
  viewer: { id?: number; isManager: boolean },
) {
  const stage = stageOf(row.progressStatus);
  return {
    ...row,
    stage,
    stageLabel: STAGE_LABEL[stage],
    mediaCount,
    // "Mine" means work I'm carrying, not everything I've ever typed in — an
    // idea logged for someone else belongs in "up for grabs", so this keys on
    // credit and assignment rather than who submitted it.
    isMine: !!viewer.id && (row.creditedTo === viewer.id || row.assignedTo === viewer.id),
    canMarkDone: canMarkDone(row.progressStatus, mediaCount),
    markDoneBlocker: markDoneBlocker(row.progressStatus, mediaCount),
    canReview: viewer.isManager && canReview(row.progressStatus),
  };
}

async function viewerOf(req: Request): Promise<{ id?: number; isManager: boolean }> {
  const id = req.session.userId ?? undefined;
  let role: string | undefined = req.session.userRole;
  if (id && !role) {
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, id));
    role = user?.role;
    if (role === "admin" || role === "manager" || role === "viewer") req.session.userRole = role;
  }
  return { id, isManager: role === "admin" || role === "manager" };
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(improvementSubmissionsTable)
      .orderBy(desc(improvementSubmissionsTable.createdAt));
    const counts = await attachmentCounts(rows.map(r => r.id));
    const viewer = await viewerOf(req);
    res.json(rows.map(r => decorate(r, counts.get(r.id) ?? 0, viewer)));
  } catch (err) {
    console.error("Error fetching improvement submissions:", err);
    res.status(500).json({ error: "Failed to fetch improvement submissions" });
  }
});

// POST /:id/done — "I've done this." The team's main action, and the point
// where the media rule bites: no photo or video, no improvement. Anyone can
// mark their own work done; a manager still has to approve it.
router.post("/:id/done", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(improvementSubmissionsTable).where(eq(improvementSubmissionsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    const counts = await attachmentCounts([id]);
    const mediaCount = counts.get(id) ?? 0;
    if (!canMarkDone(row.progressStatus, mediaCount)) {
      res.status(409).json({ error: markDoneBlocker(row.progressStatus, mediaCount) });
      return;
    }

    const userId = req.session.userId ?? null;
    let userName: string | null = null;
    if (userId) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      userName = user?.name ?? null;
    }

    const [updated] = await db.update(improvementSubmissionsTable)
      .set({
        progressStatus: "awaiting_approval",
        doneAt: new Date(),
        // Whoever says they did it gets the credit, unless it's already set.
        creditedTo: row.creditedTo ?? userId,
        creditedToName: row.creditedToName ?? userName,
        // Clear any previous send-back note; this is a fresh attempt.
        reviewNote: null,
        updatedAt: new Date(),
      })
      .where(eq(improvementSubmissionsTable.id, id))
      .returning();

    res.json(decorate(updated!, mediaCount, await viewerOf(req)));
  } catch (err) {
    console.error("Error marking improvement done:", err);
    res.status(500).json({ error: "Failed to mark it as done" });
  }
});

// POST /:id/review — a manager approves it or sends it back. Approval is
// what makes an improvement count for the person who did it.
router.post("/:id/review", async (req: Request, res: Response) => {
  const viewer = await viewerOf(req);
  if (!viewer.isManager) { res.status(403).json({ error: "Manager or admin access required" }); return; }

  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const approve = req.body?.approve === true;
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) : "";
  if (!approve && !note) {
    res.status(400).json({ error: "Say what needs another look, so they know what to change." });
    return;
  }

  try {
    const [row] = await db.select().from(improvementSubmissionsTable).where(eq(improvementSubmissionsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    if (!canReview(row.progressStatus)) {
      res.status(409).json({ error: "This one isn't waiting for approval." });
      return;
    }

    let reviewerName: string | null = null;
    if (viewer.id) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, viewer.id));
      reviewerName = user?.name ?? null;
    }

    // A manager may move the credit — the person who did the work isn't
    // always the person who typed it in.
    let creditedTo = row.creditedTo;
    let creditedToName = row.creditedToName;
    if (approve && req.body?.creditedTo != null) {
      const creditId = parseInt(String(req.body.creditedTo), 10);
      if (isNaN(creditId)) { res.status(400).json({ error: "Invalid creditedTo" }); return; }
      const [person] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, creditId));
      if (!person) { res.status(400).json({ error: "That person isn't on the team list." }); return; }
      creditedTo = creditId;
      creditedToName = person.name;
    }

    const [updated] = await db.update(improvementSubmissionsTable)
      .set({
        progressStatus: approve ? "complete" : "rejected",
        approvedBy: viewer.id ?? null,
        approvedByName: reviewerName,
        approvedAt: approve ? new Date() : null,
        reviewNote: note || null,
        creditedTo,
        creditedToName,
        updatedAt: new Date(),
      })
      .where(eq(improvementSubmissionsTable.id, id))
      .returning();

    const counts = await attachmentCounts([id]);
    res.json(decorate(updated!, counts.get(id) ?? 0, viewer));
  } catch (err) {
    console.error("Error reviewing improvement:", err);
    res.status(500).json({ error: "Failed to save the review" });
  }
});

// GET /scoreboard — approved improvements per person. The number that makes
// the whole thing worth doing (Objective E: improvements per person).
router.get("/scoreboard", async (_req: Request, res: Response) => {
  try {
    const result = await db.execute<{ user_id: number | null; name: string | null; n: number; last_at: Date | null }>(sql`
      SELECT credited_to AS user_id,
             COALESCE(credited_to_name, 'Unknown') AS name,
             COUNT(*)::int AS n,
             MAX(approved_at) AS last_at
        FROM improvement_submissions
       WHERE progress_status = 'complete' AND credited_to IS NOT NULL
       GROUP BY credited_to, credited_to_name
       ORDER BY n DESC, name ASC
    `);
    res.json((result.rows ?? []).map(r => ({
      userId: r.user_id, name: r.name, count: Number(r.n), lastAt: r.last_at,
    })));
  } catch (err) {
    console.error("Error building improvement scoreboard:", err);
    res.status(500).json({ error: "Failed to load the scoreboard" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    // `claim` false = "it needs doing", logged for whoever picks it up. It
    // stays unassigned so it surfaces as up for grabs rather than sitting on
    // the reporter's own list. Defaults true (the old behaviour) so existing
    // callers — the Report modal, the station screens — are unaffected.
    const { title, description, station, type, reportContext, claim } = req.body;
    const claimed = claim !== false;
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
        // Claimed submissions start assigned to whoever raised them; managers
        // can reassign from the Improvements table.
        assignedTo: claimed ? userId ?? null : null,
        assignedToName: claimed ? submittedByName : null,
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
  const rows = toRows<AttachmentRow & { phase: string | null }>(await db.execute(sql`
    SELECT id, kind, mime, file_name, created_at, phase
    FROM improvement_attachments WHERE improvement_id = ${id} ORDER BY created_at ASC
  `));
  res.json(rows.map(a => ({
    id: a.id, kind: a.kind, mime: a.mime, fileName: a.file_name, phase: a.phase,
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
  // "before" = what it looked like when the problem was spotted, "after" =
  // once it was fixed. Anything else is just a photo (migration 0060).
  const phase = req.body?.phase === "before" || req.body?.phase === "after" ? req.body.phase : null;
  const rows = toRows<{ id: number }>(await db.execute(sql`
    INSERT INTO improvement_attachments (improvement_id, kind, mime, data, file_name, phase)
    VALUES (${id}, ${isImage ? "image" : "video"}, ${mime}, ${req.file.buffer}, ${req.file.originalname ?? null}, ${phase})
    RETURNING id
  `));
  res.status(201).json({ id: rows[0]?.id, kind: isImage ? "image" : "video", mime, phase });
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
