import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";

// ── Per-user to-do lists ────────────────────────────────────────────────────
// Every user has their own list. Managers and admins can put tasks on
// ANYONE'S list; everyone can put tasks on their own. A task somebody else
// raised for you must be ACKNOWLEDGED — the client shows it full-screen until
// you confirm you've seen and understood it — and every task carries a
// comment thread so "what do you actually mean?" happens on the task, not in
// the kitchen doorway.
//
// Permissions, in one place:
//   see a list        → own list, or manager/admin for anyone's
//   create            → manager/admin for anyone; others only for themselves
//   edit / schedule   → manager/admin, or the assignee (edits are logged to
//                       the timeline, so a reworded task is visible history)
//   delete            → manager/admin, or the task's creator
//   acknowledge       → the assignee only — it means "I have seen this"
//   complete / reopen → manager/admin or the assignee
//   comment           → anyone who can see the task

const router: IRouter = Router();

// Same media rules as improvement attachments (routes/improvements.ts):
// one file per upload, 100MB cap for short clips, images tighter at 10MB,
// bytea in Postgres so no object storage is needed.
const mediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime", "video/ogg"];

const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
type Priority = (typeof PRIORITIES)[number];

interface TaskRow {
  [key: string]: unknown;
  id: number;
  assignee_id: number;
  assignee_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
  title: string;
  notes: string | null;
  url: string | null;
  priority: Priority;
  scheduled_for: string | null;
  due_date: string | null;
  status: "open" | "done";
  acknowledged_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  comment_count: number;
  attachment_count: number;
  improvement_id: number | null;
}

async function sessionUser(req: Request): Promise<{ id: number; role: string } | null> {
  const id = req.session.userId;
  if (!id) return null;
  // Older sessions may predate userRole being stamped at login — backfill it
  // (same lazy pattern as requireAdmin in routes/index.ts) so a manager isn't
  // silently treated as a viewer.
  if (!req.session.userRole) {
    const rows = await db.execute<{ role: string }>(sql`SELECT role FROM app_users WHERE id = ${id} LIMIT 1`);
    const role = rows.rows[0]?.role;
    if (role === "admin" || role === "manager" || role === "viewer") req.session.userRole = role;
  }
  return { id, role: req.session.userRole ?? "viewer" };
}

function isManager(role: string): boolean {
  return role === "admin" || role === "manager";
}

async function userName(id: number): Promise<string> {
  const rows = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${id} LIMIT 1`);
  return rows.rows[0]?.name ?? "Someone";
}

const TASK_SELECT = sql`
  SELECT t.*,
         au.name AS assignee_name,
         (SELECT COUNT(*)::int FROM todo_task_comments c WHERE c.task_id = t.id AND c.kind = 'comment') AS comment_count,
         (SELECT COUNT(*)::int FROM todo_task_attachments a WHERE a.task_id = t.id) AS attachment_count
  FROM todo_tasks t
  LEFT JOIN app_users au ON au.id = t.assignee_id
`;

async function taskById(id: number): Promise<TaskRow | null> {
  // Express 5 dropped regex route params, so /:id can receive anything —
  // treat a non-integer as simply not found rather than a SQL error.
  if (!Number.isInteger(id)) return null;
  const rows = await db.execute<TaskRow>(sql`${TASK_SELECT} WHERE t.id = ${id} LIMIT 1`);
  return rows.rows[0] ?? null;
}

/** May this user see (and comment on) this task at all? */
function canSee(user: { id: number; role: string }, task: TaskRow): boolean {
  return isManager(user.role) || task.assignee_id === user.id || task.created_by === user.id;
}

async function addTimeline(taskId: number, userId: number | null, name: string, kind: "comment" | "event", body: string) {
  await db.execute(sql`
    INSERT INTO todo_task_comments (task_id, user_id, user_name, kind, body)
    VALUES (${taskId}, ${userId}, ${name}, ${kind}, ${body})
  `);
}

async function notify(userId: number, message: string) {
  try {
    await db.execute(sql`
      INSERT INTO notifications (user_id, type, message, read)
      VALUES (${userId}, ${"todo"}, ${message.slice(0, 500)}, false)
    `);
  } catch (err) {
    // A missed bell must never fail the action itself.
    console.warn("[Todos] notification insert failed:", err instanceof Error ? err.message : err);
  }
}

// ── Reads ──────────────────────────────────────────────────────────────────

// GET /api/todos/mine — the caller's list, open first, newest-scheduled first.
// Done tasks come along (limited) so the list can show a "recently finished"
// tail without a second call.
router.get("/mine", async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  await listForUser(user.id, res);
});

// GET /api/todos/user/:id — someone else's list. Managers/admins only
// (viewing your own via this path is also fine).
router.get("/user/:id", async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId)) { res.status(400).json({ error: "Invalid user id" }); return; }
  if (targetId !== user.id && !isManager(user.role)) {
    res.status(403).json({ error: "Only managers can view other people's lists" });
    return;
  }
  await listForUser(targetId, res);
});

async function listForUser(userId: number, res: Response) {
  try {
    const open = await db.execute<TaskRow>(sql`
      ${TASK_SELECT}
      WHERE t.assignee_id = ${userId} AND t.status = 'open'
      ORDER BY
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        t.due_date ASC NULLS LAST,
        t.scheduled_for ASC NULLS LAST,
        t.created_at ASC
    `);
    const done = await db.execute<TaskRow>(sql`
      ${TASK_SELECT}
      WHERE t.assignee_id = ${userId} AND t.status = 'done'
      ORDER BY t.completed_at DESC NULLS LAST
      LIMIT 20
    `);
    res.json({ open: open.rows, done: done.rows });
  } catch (err) {
    console.error("[Todos] list error:", err);
    res.status(500).json({ error: "Failed to load to-dos" });
  }
}

// GET /api/todos/unacknowledged — tasks OTHERS put on my list that I haven't
// confirmed seeing yet. Polled from the layout; a non-empty answer raises the
// full-screen "you've been asked to…" takeover.
router.get("/unacknowledged", async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const rows = await db.execute<TaskRow>(sql`
      ${TASK_SELECT}
      WHERE t.assignee_id = ${user.id}
        AND t.status = 'open'
        AND t.acknowledged_at IS NULL
        AND t.created_by IS DISTINCT FROM t.assignee_id
      ORDER BY
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        t.created_at ASC
    `);
    res.json(rows.rows);
  } catch (err) {
    console.error("[Todos] unacknowledged error:", err);
    res.status(500).json({ error: "Failed to load new to-dos" });
  }
});

// GET /api/todos/:id — one task with its full timeline.
router.get("/:id", async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const task = await taskById(Number(req.params.id));
    if (!task || !canSee(user, task)) { res.status(404).json({ error: "Task not found" }); return; }
    const comments = await db.execute(sql`
      SELECT id, user_id, user_name, kind, body, created_at
      FROM todo_task_comments
      WHERE task_id = ${task.id}
      ORDER BY created_at ASC, id ASC
    `);
    const attachments = await db.execute(sql`
      SELECT id, kind, mime, file_name, uploaded_by, uploaded_by_name, created_at
      FROM todo_task_attachments
      WHERE task_id = ${task.id}
      ORDER BY created_at ASC, id ASC
    `);
    res.json({ ...task, comments: comments.rows, attachments: attachments.rows });
  } catch (err) {
    console.error("[Todos] get error:", err);
    res.status(500).json({ error: "Failed to load task" });
  }
});

// ── Writes ─────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CreateBody = z.object({
  assigneeId: z.number().int(),
  title: z.string().trim().min(1).max(300),
  notes: z.string().trim().max(5000).optional(),
  url: z.string().trim().max(2000).optional(),
  priority: z.enum(PRIORITIES).default("normal"),
  scheduledFor: z.string().regex(DATE_RE).nullish(),
  dueDate: z.string().regex(DATE_RE).nullish(),
});

router.post("/", async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A title (and a valid assignee) is required" }); return; }
  const b = parsed.data;
  if (b.assigneeId !== user.id && !isManager(user.role)) {
    res.status(403).json({ error: "Only managers can add to other people's lists" });
    return;
  }
  try {
    const creatorName = await userName(user.id);
    const rows = await db.execute<{ id: number }>(sql`
      INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, scheduled_for, due_date)
      VALUES (${b.assigneeId}, ${user.id}, ${creatorName}, ${b.title}, ${b.notes ?? null}, ${b.url ?? null},
              ${b.priority}, ${b.scheduledFor ?? null}, ${b.dueDate ?? null})
      RETURNING id
    `);
    const id = rows.rows[0].id;
    await addTimeline(id, user.id, creatorName, "event", `${creatorName} created this task`);
    if (b.assigneeId !== user.id) {
      await notify(b.assigneeId, `New to-do from ${creatorName}: ${b.title}`);
    }
    res.json(await taskById(id));
  } catch (err) {
    console.error("[Todos] create error:", err);
    res.status(500).json({ error: "Failed to create task" });
  }
});

const EditBody = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  notes: z.string().trim().max(5000).nullish(),
  url: z.string().trim().max(2000).nullish(),
  priority: z.enum(PRIORITIES).optional(),
  scheduledFor: z.string().regex(DATE_RE).nullish(),
  dueDate: z.string().regex(DATE_RE).nullish(),
});

router.patch("/:id", async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const parsed = EditBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid edit" }); return; }
  try {
    const task = await taskById(Number(req.params.id));
    if (!task || !canSee(user, task)) { res.status(404).json({ error: "Task not found" }); return; }
    if (!isManager(user.role) && task.assignee_id !== user.id) {
      res.status(403).json({ error: "You can't edit this task" });
      return;
    }
    const b = parsed.data;
    // undefined = leave alone; null = clear. hasOwnProperty distinguishes.
    const has = (k: string) => Object.prototype.hasOwnProperty.call(req.body ?? {}, k);
    await db.execute(sql`
      UPDATE todo_tasks SET
        title = ${b.title !== undefined ? b.title : task.title},
        notes = ${has("notes") ? (b.notes ?? null) : task.notes},
        url = ${has("url") ? (b.url ?? null) : task.url},
        priority = ${b.priority ?? task.priority},
        scheduled_for = ${has("scheduledFor") ? (b.scheduledFor ?? null) : task.scheduled_for},
        due_date = ${has("dueDate") ? (b.dueDate ?? null) : task.due_date},
        updated_at = NOW()
      WHERE id = ${task.id}
    `);
    const editorName = await userName(user.id);
    await addTimeline(task.id, user.id, editorName, "event", `${editorName} edited the task`);
    res.json(await taskById(task.id));
  } catch (err) {
    console.error("[Todos] edit error:", err);
    res.status(500).json({ error: "Failed to edit task" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const task = await taskById(Number(req.params.id));
    if (!task || !canSee(user, task)) { res.status(404).json({ error: "Task not found" }); return; }
    if (!isManager(user.role) && task.created_by !== user.id) {
      res.status(403).json({ error: "Only managers or whoever created it can delete a task" });
      return;
    }
    await db.execute(sql`DELETE FROM todo_tasks WHERE id = ${task.id}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[Todos] delete error:", err);
    res.status(500).json({ error: "Failed to delete task" });
  }
});

// The three status moves are deliberately separate endpoints, not a PATCH
// field — each writes its own timeline entry and has its own permission.

router.post("/:id/acknowledge", async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const task = await taskById(Number(req.params.id));
    if (!task || !canSee(user, task)) { res.status(404).json({ error: "Task not found" }); return; }
    if (task.assignee_id !== user.id) {
      res.status(403).json({ error: "Only the person it's assigned to can acknowledge a task" });
      return;
    }
    if (!task.acknowledged_at) {
      await db.execute(sql`UPDATE todo_tasks SET acknowledged_at = NOW(), updated_at = NOW() WHERE id = ${task.id}`);
      const name = await userName(user.id);
      await addTimeline(task.id, user.id, name, "event", `${name} has seen and understood this task`);
      if (task.created_by && task.created_by !== user.id) {
        await notify(task.created_by, `${name} has seen your to-do: ${task.title}`);
      }
    }
    res.json(await taskById(task.id));
  } catch (err) {
    console.error("[Todos] acknowledge error:", err);
    res.status(500).json({ error: "Failed to acknowledge task" });
  }
});

router.post("/:id/complete", async (req: Request, res: Response) => {
  await setDone(req, res, true);
});
router.post("/:id/reopen", async (req: Request, res: Response) => {
  await setDone(req, res, false);
});

async function setDone(req: Request, res: Response, done: boolean) {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const task = await taskById(Number(req.params.id));
    if (!task || !canSee(user, task)) { res.status(404).json({ error: "Task not found" }); return; }
    if (!isManager(user.role) && task.assignee_id !== user.id) {
      res.status(403).json({ error: "You can't change this task" });
      return;
    }
    await db.execute(sql`
      UPDATE todo_tasks SET
        status = ${done ? "done" : "open"},
        completed_at = ${done ? sql`NOW()` : null},
        updated_at = NOW()
      WHERE id = ${task.id}
    `);
    const name = await userName(user.id);
    await addTimeline(task.id, user.id, name, "event", done ? `${name} marked this done` : `${name} reopened this task`);
    if (done && task.created_by && task.created_by !== user.id) {
      await notify(task.created_by, `${name} completed: ${task.title}`);
    }
    res.json(await taskById(task.id));
  } catch (err) {
    console.error("[Todos] complete/reopen error:", err);
    res.status(500).json({ error: "Failed to update task" });
  }
}

const CommentBody = z.object({ body: z.string().trim().min(1).max(2000) });

router.post("/:id/comments", async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const parsed = CommentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Comment text is required" }); return; }
  try {
    const task = await taskById(Number(req.params.id));
    if (!task || !canSee(user, task)) { res.status(404).json({ error: "Task not found" }); return; }
    const name = await userName(user.id);
    await addTimeline(task.id, user.id, name, "comment", parsed.data.body);
    // Tell the other side of the conversation — assignee if a manager
    // commented, creator if the assignee commented.
    const recipient = user.id === task.assignee_id ? task.created_by : task.assignee_id;
    if (recipient && recipient !== user.id) {
      await notify(recipient, `${name} commented on: ${task.title}`);
    }
    const comments = await db.execute(sql`
      SELECT id, user_id, user_name, kind, body, created_at
      FROM todo_task_comments WHERE task_id = ${task.id}
      ORDER BY created_at ASC, id ASC
    `);
    res.json({ ok: true, comments: comments.rows });
  } catch (err) {
    console.error("[Todos] comment error:", err);
    res.status(500).json({ error: "Failed to add comment" });
  }
});

// ── Photos & videos ────────────────────────────────────────────────────────

// Upload one photo or video to a task. Anyone who can see the task can add
// evidence to it — that's the point of the media: show the job, or show the
// problem.
router.post("/:id/attachments", mediaUpload.single("file"), async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
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
  try {
    const task = await taskById(Number(req.params.id));
    if (!task || !canSee(user, task)) { res.status(404).json({ error: "Task not found" }); return; }
    const name = await userName(user.id);
    const rows = await db.execute<{ id: number }>(sql`
      INSERT INTO todo_task_attachments (task_id, uploaded_by, uploaded_by_name, kind, mime, data, file_name)
      VALUES (${task.id}, ${user.id}, ${name}, ${isImage ? "image" : "video"}, ${mime}, ${req.file.buffer}, ${req.file.originalname ?? null})
      RETURNING id
    `);
    await addTimeline(task.id, user.id, name, "event", `${name} added a ${isImage ? "photo" : "video"}`);
    res.status(201).json({ id: rows.rows[0]?.id, kind: isImage ? "image" : "video", mime });
  } catch (err) {
    console.error("[Todos] attachment upload error:", err);
    res.status(500).json({ error: "Failed to upload" });
  }
});

// Stream one attachment's bytes. Permission goes through the task it
// belongs to — same visibility as the task itself.
router.get("/attachments/:attId", async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const attId = Number(req.params.attId);
  if (!Number.isInteger(attId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const rows = await db.execute<{ mime: string; data: Buffer; kind: string; task_id: number }>(sql`
      SELECT mime, data, kind, task_id FROM todo_task_attachments WHERE id = ${attId}
    `);
    const row = rows.rows[0];
    if (!row?.data || !row.mime) { res.status(404).json({ error: "Not found" }); return; }
    const task = await taskById(row.task_id);
    if (!task || !canSee(user, task)) { res.status(404).json({ error: "Not found" }); return; }
    res.setHeader("Content-Type", row.mime);
    res.setHeader("Cache-Control", "private, max-age=300");
    if (row.kind === "video") res.setHeader("Accept-Ranges", "bytes");
    res.send(row.data);
  } catch (err) {
    console.error("[Todos] attachment stream error:", err);
    res.status(500).json({ error: "Failed to load attachment" });
  }
});

// Delete an attachment — manager, or whoever uploaded it.
router.delete("/attachments/:attId", async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const attId = Number(req.params.attId);
  if (!Number.isInteger(attId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const rows = await db.execute<{ uploaded_by: number | null; task_id: number }>(sql`
      SELECT uploaded_by, task_id FROM todo_task_attachments WHERE id = ${attId}
    `);
    const row = rows.rows[0];
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    if (!isManager(user.role) && row.uploaded_by !== user.id) {
      res.status(403).json({ error: "Only managers or whoever uploaded it can delete this" });
      return;
    }
    await db.execute(sql`DELETE FROM todo_task_attachments WHERE id = ${attId}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[Todos] attachment delete error:", err);
    res.status(500).json({ error: "Failed to delete attachment" });
  }
});

// ── Tag a task as an improvement ───────────────────────────────────────────
// A finished job often IS an improvement — the before/after photos are
// already on the task. Tagging copies the task (and its media) into the
// improvement library as a submission, credited to whoever tags it, and
// links the task so it can't be tagged twice. Manager or assignee.
router.post("/:id/tag-improvement", async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const task = await taskById(Number(req.params.id));
    if (!task || !canSee(user, task)) { res.status(404).json({ error: "Task not found" }); return; }
    if (!isManager(user.role) && task.assignee_id !== user.id) {
      res.status(403).json({ error: "Only managers or the person it's assigned to can tag this as an improvement" });
      return;
    }
    if (task.improvement_id) {
      res.json({ ok: true, improvementId: task.improvement_id, alreadyTagged: true });
      return;
    }
    const name = await userName(user.id);
    const description = [
      task.notes?.trim() || task.title,
      task.url ? `Link: ${task.url}` : null,
      `From ${task.assignee_name ?? "a team member"}'s to-do list${task.created_by_name ? ` (task set by ${task.created_by_name})` : ""}.`,
    ].filter(Boolean).join("\n\n");
    const created = await db.execute<{ id: number }>(sql`
      INSERT INTO improvement_submissions
        (title, description, station, type, submitted_by, submitted_by_name, assigned_to, assigned_to_name)
      VALUES
        (${task.title}, ${description}, ${"To-do list"}, ${"improvement"},
         ${user.id}, ${name}, ${task.assignee_id}, ${task.assignee_name})
      RETURNING id
    `);
    const improvementId = created.rows[0].id;
    // Copy the media across so the library entry stands on its own even if
    // the task is later deleted.
    await db.execute(sql`
      INSERT INTO improvement_attachments (improvement_id, kind, mime, data, file_name)
      SELECT ${improvementId}, kind, mime, data, file_name
      FROM todo_task_attachments WHERE task_id = ${task.id}
    `);
    await db.execute(sql`UPDATE todo_tasks SET improvement_id = ${improvementId}, updated_at = NOW() WHERE id = ${task.id}`);
    await addTimeline(task.id, user.id, name, "event", `${name} tagged this as an improvement — it's in the improvement library`);
    res.json({ ok: true, improvementId });
  } catch (err) {
    console.error("[Todos] tag-improvement error:", err);
    res.status(500).json({ error: "Failed to tag as improvement" });
  }
});

export default router;
