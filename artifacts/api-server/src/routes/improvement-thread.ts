/**
 * Comments & photos on an improvement — the timeline behind every card
 * (Graeme, 27 Oct 2026; Objective E).
 *
 *   GET    /api/improvements/:id/thread                 the timeline, oldest first
 *   GET    /api/improvements/:id/comments               the bare comments (the management table)
 *   POST   /api/improvements/:id/comments               { comment }
 *   POST   /api/improvements/:id/comments/photo         multipart: file (+ optional comment)
 *   DELETE /api/improvements/:id/comments/:commentId    the author, or a manager/admin
 *
 * Anyone signed in can comment. A photo is stored like every other
 * improvement photo (bytea in improvement_attachments, streamed from
 * /api/improvements/attachments/:id) with comment_id set (migration 0331),
 * so it never counts as the improvement's before/after evidence.
 *
 * A new comment tells whoever logged the improvement, everyone credited on
 * it, the reporter of the issue it came from, and anyone already in the
 * conversation — on the bell (opening the timeline) and by push where
 * they've opted in. Never the commenter. Rules: lib/improvement-thread.ts.
 *
 * Mounted at /improvements AHEAD of the main improvements router; nothing
 * here clashes with its paths.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, improvementSubmissionsTable, improvementCommentsTable, notificationsTable, usersTable, formatCreditNames } from "@workspace/db";
import { asc, eq, sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { resolveRole } from "../middleware/roles";
import { singleFileUpload } from "../middleware/upload";
import { creditsFor } from "../lib/improvement-credits-data";
import {
  buildImprovementThread, canDeleteComment, commentNotification, commentRecipients,
  COMMENT_NOTIFICATION_TYPE, type CommentRecipientReason,
} from "../lib/improvement-thread";
import { sendPushToUsers } from "../services/push";

const router: IRouter = Router();

// Photos only in the conversation (10MB, the same cap as every improvement photo).
const photoUpload = singleFileUpload("file", 10);
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_COMMENT = 4000;

const rowsOf = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function nameOf(userId: number): Promise<string | null> {
  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  return user?.name ?? null;
}

async function loadImprovement(id: number) {
  const [row] = await db.select().from(improvementSubmissionsTable).where(eq(improvementSubmissionsTable.id, id));
  return row ?? null;
}

/**
 * Tell everyone who should hear about this comment. Fire-and-forget from
 * the routes: a notification hiccup must never lose someone's comment.
 */
async function notifyComment(opts: {
  improvementId: number;
  commentId: number;
  commenterId: number;
  commenterName: string | null;
  text: string;
  hasPhoto: boolean;
}) {
  const improvement = await loadImprovement(opts.improvementId);
  if (!improvement) return;
  const credits = (await creditsFor([improvement])).get(improvement.id) ?? [];
  const reporters = rowsOf<{ reported_by: number }>(await db.execute(sql`
    SELECT DISTINCT reported_by FROM andon_issues
     WHERE improvement_id = ${improvement.id} AND reported_by IS NOT NULL
  `)).map(r => Number(r.reported_by));
  const earlier = rowsOf<{ user_id: number }>(await db.execute(sql`
    SELECT DISTINCT user_id FROM improvement_comments
     WHERE improvement_id = ${improvement.id} AND id <> ${opts.commentId} AND user_id IS NOT NULL
  `)).map(r => Number(r.user_id));

  const recipients = commentRecipients({
    commenterId: opts.commenterId,
    submittedBy: improvement.submittedBy,
    creditedUserIds: credits.map(c => c.userId),
    issueReporterIds: reporters,
    earlierCommenterIds: earlier,
  });
  if (recipients.length === 0) return;

  const byReason = new Map<CommentRecipientReason, number[]>();
  for (const r of recipients) byReason.set(r.reason, [...(byReason.get(r.reason) ?? []), r.userId]);

  for (const [reason, userIds] of byReason) {
    const words = commentNotification({
      commenterName: opts.commenterName,
      title: improvement.title,
      text: opts.text,
      hasPhoto: opts.hasPhoto,
      reason,
    });
    await db.insert(notificationsTable).values(userIds.map(userId => ({
      userId, type: COMMENT_NOTIFICATION_TYPE, message: words.message, improvementId: improvement.id,
    })));
    await sendPushToUsers(userIds, {
      title: words.pushTitle,
      body: words.pushBody,
      url: `/improvements?open=${improvement.id}&thread=1`,
      tag: `improvement-comment-${improvement.id}`,
    });
  }
}

function notifyInBackground(opts: Parameters<typeof notifyComment>[0]) {
  notifyComment(opts).catch(err =>
    console.error(`[Improvements] comment notify failed for improvement ${opts.improvementId}:`, err));
}

// ── The timeline ─────────────────────────────────────────────────────────────

router.get("/:id/thread", async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const improvement = await loadImprovement(id);
    if (!improvement) { res.status(404).json({ error: "This improvement has gone — it may have been deleted." }); return; }
    const credits = (await creditsFor([improvement])).get(id) ?? [];
    const comments = await db.select().from(improvementCommentsTable)
      .where(eq(improvementCommentsTable.improvementId, id))
      .orderBy(asc(improvementCommentsTable.createdAt), asc(improvementCommentsTable.id));
    const attachments = rowsOf<{ id: number; comment_id: number | null; kind: string; phase: string | null }>(await db.execute(sql`
      SELECT id, comment_id, kind, phase FROM improvement_attachments WHERE improvement_id = ${id}
    `));
    const role = await resolveRole(req);
    const entries = buildImprovementThread({
      improvement: {
        createdAt: improvement.createdAt,
        doneAt: improvement.doneAt,
        submittedByName: improvement.submittedByName,
        creditNames: formatCreditNames(credits.map(c => c.name)) ?? improvement.creditedToName,
        title: improvement.title,
        description: improvement.description,
      },
      comments,
      attachments: attachments.map(a => ({ id: Number(a.id), commentId: a.comment_id == null ? null : Number(a.comment_id), kind: a.kind, phase: a.phase })),
      viewer: { userId: req.session.userId ?? null, role },
    });
    res.json({ improvementId: id, title: improvement.title, entries });
  } catch (err) {
    console.error("[Improvements] thread failed:", err);
    res.status(500).json({ error: "Couldn't load the comments" });
  }
});

// The bare comment rows — still read by the management table's pop-up. A
// photo posted with no words reads as one there.
router.get("/:id/comments", async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const rows = await db.select().from(improvementCommentsTable)
      .where(eq(improvementCommentsTable.improvementId, id))
      .orderBy(asc(improvementCommentsTable.createdAt), asc(improvementCommentsTable.id));
    res.json(rows.map(r => ({ ...r, comment: r.comment.trim() ? r.comment : "📷 Added a photo" })));
  } catch (err) {
    console.error("Error fetching comments:", err);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

// ── Commenting ───────────────────────────────────────────────────────────────

const commentSchema = z.object({
  comment: z.string().trim().min(1, "Write something first").max(MAX_COMMENT, `Keep it under ${MAX_COMMENT} characters`),
});

router.post("/:id/comments", validate(commentSchema), async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Sign in to comment" }); return; }
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }
  const { comment } = req.body as z.infer<typeof commentSchema>;
  try {
    if (!(await loadImprovement(id))) { res.status(404).json({ error: "This improvement has gone — it may have been deleted." }); return; }
    const userName = await nameOf(userId);
    const [row] = await db.insert(improvementCommentsTable)
      .values({ improvementId: id, userId, userName, comment })
      .returning();
    notifyInBackground({ improvementId: id, commentId: row!.id, commenterId: userId, commenterName: userName, text: comment, hasPhoto: false });
    res.status(201).json(row);
  } catch (err) {
    console.error("Error creating comment:", err);
    res.status(500).json({ error: "Couldn't save your comment" });
  }
});

// A photo, with optional words, as one post in the conversation.
const photoSchema = z.object({
  comment: z.string().max(MAX_COMMENT, `Keep it under ${MAX_COMMENT} characters`).optional(),
});

router.post("/:id/comments/photo", photoUpload, validate(photoSchema), async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Sign in to comment" }); return; }
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!req.file) { res.status(400).json({ error: "No photo came through — try again." }); return; }
  if (!IMAGE_MIMES.includes(req.file.mimetype)) {
    res.status(400).json({ error: "That isn't a photo we can show — use a JPEG, PNG, WebP or GIF." });
    return;
  }
  const text = ((req.body as z.infer<typeof photoSchema>).comment ?? "").trim();
  try {
    if (!(await loadImprovement(id))) { res.status(404).json({ error: "This improvement has gone — it may have been deleted." }); return; }
    const userName = await nameOf(userId);
    const file = req.file;
    const saved = await db.transaction(async tx => {
      const [row] = await tx.insert(improvementCommentsTable)
        .values({ improvementId: id, userId, userName, comment: text })
        .returning();
      const att = rowsOf<{ id: number }>(await tx.execute(sql`
        INSERT INTO improvement_attachments (improvement_id, kind, mime, data, file_name, comment_id)
        VALUES (${id}, 'image', ${file.mimetype}, ${file.buffer}, ${file.originalname ?? null}, ${row!.id})
        RETURNING id
      `));
      return { comment: row!, attachmentId: Number(att[0]?.id) };
    });
    notifyInBackground({ improvementId: id, commentId: saved.comment.id, commenterId: userId, commenterName: userName, text, hasPhoto: true });
    res.status(201).json(saved);
  } catch (err) {
    console.error("Error saving comment photo:", err);
    res.status(500).json({ error: "Couldn't save your photo" });
  }
});

// Delete a comment (and any photo posted with it): the author, or a manager/admin.
router.delete("/:id/comments/:commentId", async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not signed in" }); return; }
  const id = parseId(req.params.id);
  const commentId = parseId(req.params.commentId);
  if (id == null || commentId == null) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(improvementCommentsTable).where(eq(improvementCommentsTable.id, commentId));
    if (!row || row.improvementId !== id) { res.status(404).json({ error: "That comment has already gone." }); return; }
    const role = await resolveRole(req);
    if (!canDeleteComment({ userId, role }, row.userId)) {
      res.status(403).json({ error: "Only the person who wrote it, or a manager, can delete a comment." });
      return;
    }
    await db.delete(improvementCommentsTable).where(eq(improvementCommentsTable.id, commentId));
    console.log(`[Improvements] comment ${commentId} on #${id} (by ${row.userName ?? "unknown"}) deleted by user ${userId}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error deleting comment:", err);
    res.status(500).json({ error: "Couldn't delete the comment" });
  }
});

export default router;
