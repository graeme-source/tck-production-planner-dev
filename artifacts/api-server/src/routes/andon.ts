import { Router, type IRouter, type Request, type Response } from "express";
import { singleFileUpload } from "../middleware/upload";
import { db, andonIssuesTable, andonCommentsTable, usersTable, notificationsTable, improvementSubmissionsTable } from "@workspace/db";
import { eq, isNull, desc, asc, and, SQL, sql } from "drizzle-orm";
import type { AndonIssue } from "@workspace/db";

const router: IRouter = Router();

// --- Notification helper ----------------------------------------------------

const ANDON_CATEGORY_LABELS: Record<string, string> = {
  equipment: "Equipment",
  safety: "Safety",
  production: "Production",
  product: "Product",
  other: "Other",
};

async function notifyReporter(
  andonIssueId: number,
  actorUserId: number,
  actorName: string,
  type: "comment" | "acknowledged" | "resolved",
) {
  const [issue] = await db
    .select({ reportedBy: andonIssuesTable.reportedBy, category: andonIssuesTable.category, station: andonIssuesTable.station })
    .from(andonIssuesTable)
    .where(eq(andonIssuesTable.id, andonIssueId));
  if (!issue?.reportedBy || issue.reportedBy === actorUserId) return;

  const label = ANDON_CATEGORY_LABELS[issue.category] ?? issue.category;
  const messages: Record<string, string> = {
    comment: `${actorName} commented on your issue: ${label} - ${issue.station}`,
    acknowledged: `${actorName} acknowledged your issue: ${label} - ${issue.station}`,
    resolved: `${actorName} resolved your issue: ${label} - ${issue.station}`,
  };

  await db.insert(notificationsTable).values({
    userId: issue.reportedBy,
    type,
    message: messages[type],
    andonIssueId,
  });
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const { station, category, severity, open } = req.query;
    const conditions: SQL[] = [];
    if (station) conditions.push(eq(andonIssuesTable.station, String(station)));
    if (category) conditions.push(eq(andonIssuesTable.category, String(category) as AndonIssue["category"]));
    if (severity) conditions.push(eq(andonIssuesTable.severity, String(severity) as AndonIssue["severity"]));
    if (open === "true") conditions.push(isNull(andonIssuesTable.resolvedAt));

    const rows = await db
      .select()
      .from(andonIssuesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(andonIssuesTable.createdAt));

    res.json(rows);
  } catch (err) {
    console.error("Error fetching andon issues:", err);
    res.status(500).json({ error: "Failed to fetch andon issues" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    // area tells the two kinds of problem apart at the point of reporting:
    // 'factory' is something physical, 'system' is the app misbehaving on the
    // iPad. They reach different people (migration 0060).
    const { category, severity, description, station, reportContext, area } = req.body;
    const issueArea = area === "system" || area === "factory" ? area : null;
    if (!category || !severity || !station) {
      res.status(400).json({ error: "category, severity, and station are required" });
      return;
    }

    const userId = req.session.userId;
    let reportedByName: string | null = null;
    if (userId) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      reportedByName = user?.name ?? null;
    }

    const [row] = await db
      .insert(andonIssuesTable)
      .values({
        category,
        severity,
        description: description ?? null,
        station,
        reportedBy: userId ?? null,
        reportedByName,
        reportContext: reportContext || null,
        area: issueArea,
      })
      .returning();

    res.status(201).json(row);
  } catch (err) {
    console.error("Error creating andon issue:", err);
    res.status(500).json({ error: "Failed to create andon issue" });
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

    const { category, severity, description, station } = req.body;

    type UpdatePayload = Partial<Pick<AndonIssue, "category" | "severity" | "description" | "station">>;
    const updates: UpdatePayload = {};
    if (category !== undefined) updates.category = category;
    if (severity !== undefined) updates.severity = severity;
    if (description !== undefined) updates.description = description;
    if (station !== undefined) updates.station = station;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [row] = await db
      .update(andonIssuesTable)
      .set(updates)
      .where(eq(andonIssuesTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json(row);
  } catch (err) {
    console.error("Error updating andon issue:", err);
    res.status(500).json({ error: "Failed to update andon issue" });
  }
});

router.patch("/:id/acknowledge", async (req: Request, res: Response) => {
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

    const userId = req.session.userId;
    let acknowledgedByName: string | null = null;
    if (userId) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      acknowledgedByName = user?.name ?? null;
    }

    const [row] = await db
      .update(andonIssuesTable)
      .set({
        acknowledgedBy: userId ?? null,
        acknowledgedByName,
        acknowledgedAt: new Date(),
      })
      .where(eq(andonIssuesTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json(row);

    try { await notifyReporter(id, userId!, acknowledgedByName ?? "Someone", "acknowledged"); }
    catch (e) { console.warn("[notifications] Failed:", e); }
  } catch (err) {
    console.error("Error acknowledging andon issue:", err);
    res.status(500).json({ error: "Failed to acknowledge andon issue" });
  }
});

router.patch("/:id/resolve", async (req: Request, res: Response) => {
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

    const userId = req.session.userId;
    let resolvedByName: string | null = null;
    if (userId) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      resolvedByName = user?.name ?? null;
    }

    const [row] = await db
      .update(andonIssuesTable)
      .set({
        resolvedBy: userId ?? null,
        resolvedByName,
        resolvedAt: new Date(),
      })
      .where(eq(andonIssuesTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json(row);

    try { await notifyReporter(id, userId!, resolvedByName ?? "Someone", "resolved"); }
    catch (e) { console.warn("[notifications] Failed:", e); }
  } catch (err) {
    console.error("Error resolving andon issue:", err);
    res.status(500).json({ error: "Failed to resolve andon issue" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
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

    const [row] = await db
      .delete(andonIssuesTable)
      .where(eq(andonIssuesTable.id, id))
      .returning({ id: andonIssuesTable.id });

    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    console.error("Error deleting andon issue:", err);
    res.status(500).json({ error: "Failed to delete andon issue" });
  }
});

// --- Comments ---------------------------------------------------------------

router.get("/:id/comments", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const rows = await db
      .select()
      .from(andonCommentsTable)
      .where(eq(andonCommentsTable.andonId, id))
      .orderBy(asc(andonCommentsTable.createdAt));
    res.json(rows);
  } catch (err) {
    console.error("Error fetching andon comments:", err);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

router.post("/:id/comments", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { comment } = req.body;
    if (!comment || typeof comment !== "string" || !comment.trim()) {
      res.status(400).json({ error: "comment is required" });
      return;
    }

    const userId = req.session.userId;
    let userName: string | null = null;
    if (userId) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      userName = user?.name ?? null;
    }

    const [row] = await db
      .insert(andonCommentsTable)
      .values({ andonId: id, userId: userId ?? null, userName, comment: comment.trim() })
      .returning();
    res.status(201).json(row);

    try { if (userId) await notifyReporter(id, userId, userName ?? "Someone", "comment"); }
    catch (e) { console.warn("[notifications] Failed:", e); }
  } catch (err) {
    console.error("Error creating andon comment:", err);
    res.status(500).json({ error: "Failed to create comment" });
  }
});

// POST /:id/tag-improvement — turn an issue into an improvement.
//
// A safety problem gets fixed by improving something, so the two shouldn't be
// separate pieces of typing. This carries the issue's own words across as the
// starting description, links the pair, and leaves the improvement as an idea
// (with no media yet) for whoever picks it up. Idempotent: tagging twice
// returns the improvement already made.
router.post("/:id/tag-improvement", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [issue] = await db.select().from(andonIssuesTable).where(eq(andonIssuesTable.id, id));
    if (!issue) { res.status(404).json({ error: "Issue not found" }); return; }
    if (issue.improvementId) {
      res.json({ ok: true, improvementId: issue.improvementId, alreadyTagged: true });
      return;
    }

    const userId = req.session.userId ?? null;
    let userName: string | null = null;
    if (userId) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      userName = user?.name ?? null;
    }

    const label = ANDON_CATEGORY_LABELS[issue.category] ?? issue.category;
    const title = (issue.description?.trim() || `${label} issue at ${issue.station}`).slice(0, 200);
    const description = [
      issue.description?.trim() || null,
      `Raised as a ${issue.severity} ${label.toLowerCase()} issue at ${issue.station}${issue.area ? ` (${issue.area})` : ""}.`,
      issue.reportedByName ? `Reported by ${issue.reportedByName}.` : null,
    ].filter(Boolean).join("\n\n");

    const [improvement] = await db.insert(improvementSubmissionsTable).values({
      title,
      description,
      station: issue.station,
      type: "improvement",
      submittedBy: userId,
      submittedByName: userName,
      // Nobody has picked it up yet — it's an opportunity, not someone's job.
      assignedTo: null,
      assignedToName: null,
      reportContext: issue.reportContext ?? null,
    }).returning({ id: improvementSubmissionsTable.id });

    await db.update(andonIssuesTable)
      .set({ improvementId: improvement!.id })
      .where(eq(andonIssuesTable.id, id));

    res.json({ ok: true, improvementId: improvement!.id });
  } catch (err) {
    console.error("[Andon] tag-improvement error:", err);
    res.status(500).json({ error: "Failed to turn this into an improvement" });
  }
});



// ── Attachments (photos, screenshots & videos) ─────────────────────────────
// Same rules as improvement attachments: images to 10MB, video to 100MB.
// Issue reports carry what the reporter can see — a photo of the problem,
// a screenshot of the app misbehaving, a short clip (Graeme, 2026-08-28).

const mediaUpload = singleFileUpload("file", 100);
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime", "video/ogg"];

router.post("/:id/attachments", mediaUpload, async (req: Request, res: Response) => {
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
  const [issue] = await db.select({ id: andonIssuesTable.id }).from(andonIssuesTable).where(eq(andonIssuesTable.id, id));
  if (!issue) { res.status(404).json({ error: "Issue not found" }); return; }
  const rows = await db.execute(sql`
    INSERT INTO andon_attachments (issue_id, kind, mime, data, file_name)
    VALUES (${id}, ${isImage ? "image" : "video"}, ${mime}, ${req.file.buffer}, ${req.file.originalname ?? null})
    RETURNING id
  `);
  const inserted = (rows as any).rows?.[0];
  res.status(201).json({ id: inserted?.id, kind: isImage ? "image" : "video", mime });
});

router.get("/:id/attachments", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.execute(sql`
    SELECT id, kind, mime, file_name, created_at FROM andon_attachments
    WHERE issue_id = ${id} ORDER BY id
  `);
  res.json(((rows as any).rows ?? []).map((a: any) => ({
    id: a.id, kind: a.kind, mime: a.mime, fileName: a.file_name, createdAt: a.created_at,
  })));
});

router.get("/attachments/:attId/file", async (req: Request, res: Response) => {
  const attId = parseInt(String(req.params.attId), 10);
  if (isNaN(attId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.execute(sql`SELECT mime, data, file_name FROM andon_attachments WHERE id = ${attId}`);
  const a = (rows as any).rows?.[0];
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const buf = Buffer.isBuffer(a.data) ? a.data : Buffer.from(a.data);
  res.setHeader("Content-Type", a.mime);
  res.setHeader("Content-Length", String(buf.length));
  res.setHeader("Content-Disposition", `inline; filename="${(a.file_name || "attachment").replace(/["\r\n]/g, "")}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(buf);
});


export default router;
