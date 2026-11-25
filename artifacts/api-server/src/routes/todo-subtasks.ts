/**
 * Sub-tasks on personal to-dos (Graeme, 25 Nov 2026). Objectives E and F.
 *
 *   POST   /task/:taskId           add a sub-task at the end
 *   POST   /task/:taskId/reorder   set the order (the same ids, re-ordered)
 *   PATCH  /:id                    edit title / notes / link
 *   DELETE /:id                    remove it
 *   POST   /:id/tick               { done } — tick or untick, with who and when
 *
 * Permissions follow the to-do itself (routes/todos.ts): changing or ticking
 * is for managers/admins or the person it's assigned to. Sub-tasks are never
 * to-dos of their own — no notifications, no acknowledgement, no counts.
 * Ticking the parent with some left is guarded in todos.ts (setDone).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { isSameIdSet } from "@workspace/subtasks";
import { rawBody, validate } from "../middleware/validate";
import { resolveRole } from "../middleware/roles";

const router: IRouter = Router();
const MAX_SUBTASKS = 100;

const optionalText = (max: number) => z.string().trim().max(max).nullish().transform(v => (v ? v : null));
const urlField = z.string().trim().max(2000).nullish()
  .refine(v => !v || /^(https?:\/\/|\/)/i.test(v), "Links start with https:// or / (a page in the app)")
  .transform(v => (v ? v : null));
const addBody = z.object({
  title: z.string().trim().min(1, "A sub-task needs a title").max(300),
  notes: optionalText(2000),
  url: urlField,
});
const patchBody = z.object({
  title: z.string().trim().min(1, "A sub-task needs a title").max(300).optional(),
  notes: optionalText(2000),
  url: urlField,
});
const reorderBody = z.object({ subtaskIds: z.array(z.number().int().positive()).min(1).max(200) });
const tickBody = z.object({ done: z.boolean() });

function intParam(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

interface TaskAccessRow { [key: string]: unknown; id: number; assignee_id: number; created_by: number | null }

/** The to-do, if this person may change it (manager/admin or its assignee). */
async function taskFor(req: Request, res: Response, taskId: number | null): Promise<TaskAccessRow | null> {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return null; }
  const role = await resolveRole(req);
  if (!taskId) { res.status(404).json({ error: "Task not found" }); return null; }
  const rows = await db.execute<TaskAccessRow>(sql`SELECT id, assignee_id, created_by FROM todo_tasks WHERE id = ${taskId} LIMIT 1`);
  const task = rows.rows[0];
  const me = req.session.userId;
  const manager = role === "admin" || role === "manager";
  if (!task || !(manager || task.assignee_id === me || task.created_by === me)) { res.status(404).json({ error: "Task not found" }); return null; }
  if (!manager && task.assignee_id !== me) { res.status(403).json({ error: "You can't change this task" }); return null; }
  return task;
}

async function subtaskFor(req: Request, res: Response) {
  const id = intParam(req.params.id);
  if (!id) { res.status(404).json({ error: "Sub-task not found" }); return null; }
  const rows = await db.execute<{ id: number; task_id: number }>(sql`SELECT id, task_id FROM todo_subtasks WHERE id = ${id} LIMIT 1`);
  const sub = rows.rows[0];
  if (!sub) { res.status(404).json({ error: "Sub-task not found" }); return null; }
  const task = await taskFor(req, res, sub.task_id);
  return task ? { sub, task } : null;
}

async function userName(id: number): Promise<string> {
  const rows = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${id} LIMIT 1`);
  return rows.rows[0]?.name ?? "Someone";
}

const SUB_COLS = sql`id, task_id, title, notes, url, sort_order, done_at, done_by, done_by_name`;

router.post("/task/:taskId", validate(addBody), async (req: Request, res: Response) => {
  const task = await taskFor(req, res, intParam(req.params.taskId));
  if (!task) return;
  const b = req.body as z.infer<typeof addBody>;
  try {
    const [{ n, next }] = (await db.execute<{ n: number; next: number }>(
      sql`SELECT COUNT(*)::int AS n, COALESCE(MAX(sort_order), 0) + 1 AS next FROM todo_subtasks WHERE task_id = ${task.id}`,
    )).rows;
    if (Number(n) >= MAX_SUBTASKS) { res.status(400).json({ error: `A to-do can have up to ${MAX_SUBTASKS} sub-tasks` }); return; }
    const rows = await db.execute(sql`
      INSERT INTO todo_subtasks (task_id, title, notes, url, sort_order)
      VALUES (${task.id}, ${b.title}, ${b.notes}, ${b.url}, ${Number(next) || 1})
      RETURNING ${SUB_COLS}
    `);
    await db.execute(sql`UPDATE todo_tasks SET updated_at = NOW() WHERE id = ${task.id}`);
    res.status(201).json(rows.rows[0]);
  } catch (err) {
    console.error("[TodoSubtasks] add error:", err);
    res.status(500).json({ error: "Couldn't add the sub-task" });
  }
});

router.post("/task/:taskId/reorder", validate(reorderBody), async (req: Request, res: Response) => {
  const task = await taskFor(req, res, intParam(req.params.taskId));
  if (!task) return;
  const { subtaskIds } = req.body as z.infer<typeof reorderBody>;
  try {
    const current = await db.execute<{ id: number }>(sql`SELECT id FROM todo_subtasks WHERE task_id = ${task.id}`);
    if (!isSameIdSet(current.rows.map(r => r.id), subtaskIds)) {
      res.status(409).json({ error: "The sub-tasks have changed since you opened this — refresh and try again" });
      return;
    }
    await db.transaction(async tx => {
      for (const [i, id] of subtaskIds.entries()) {
        await tx.execute(sql`UPDATE todo_subtasks SET sort_order = ${i + 1}, updated_at = NOW() WHERE id = ${id} AND task_id = ${task.id}`);
      }
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[TodoSubtasks] reorder error:", err);
    res.status(500).json({ error: "Couldn't save the order" });
  }
});

router.patch("/:id", validate(patchBody), async (req: Request, res: Response) => {
  const found = await subtaskFor(req, res);
  if (!found) return;
  const b = req.body as z.infer<typeof patchBody>;
  // zod turns a missing notes/url into null, so ask what was actually sent.
  const sent = rawBody<Record<string, unknown>>(req) ?? {};
  try {
    const rows = await db.execute(sql`
      UPDATE todo_subtasks SET
        title = COALESCE(${b.title ?? null}, title),
        notes = ${"notes" in sent ? sql`${b.notes ?? null}` : sql`notes`},
        url = ${"url" in sent ? sql`${b.url ?? null}` : sql`url`},
        updated_at = NOW()
      WHERE id = ${found.sub.id}
      RETURNING ${SUB_COLS}
    `);
    res.json(rows.rows[0]);
  } catch (err) {
    console.error("[TodoSubtasks] edit error:", err);
    res.status(500).json({ error: "Couldn't save the sub-task" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  const found = await subtaskFor(req, res);
  if (!found) return;
  try {
    await db.execute(sql`DELETE FROM todo_subtasks WHERE id = ${found.sub.id}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[TodoSubtasks] delete error:", err);
    res.status(500).json({ error: "Couldn't remove the sub-task" });
  }
});

router.post("/:id/tick", validate(tickBody), async (req: Request, res: Response) => {
  const found = await subtaskFor(req, res);
  if (!found) return;
  const { done } = req.body as z.infer<typeof tickBody>;
  try {
    const me = req.session.userId!;
    const rows = done
      ? await db.execute(sql`
          UPDATE todo_subtasks SET done_at = COALESCE(done_at, NOW()), done_by = COALESCE(done_by, ${me}),
                 done_by_name = COALESCE(done_by_name, ${await userName(me)}), updated_at = NOW()
          WHERE id = ${found.sub.id} RETURNING ${SUB_COLS}`)
      : await db.execute(sql`
          UPDATE todo_subtasks SET done_at = NULL, done_by = NULL, done_by_name = NULL, updated_at = NOW()
          WHERE id = ${found.sub.id} RETURNING ${SUB_COLS}`);
    res.json(rows.rows[0]);
  } catch (err) {
    console.error("[TodoSubtasks] tick error:", err);
    res.status(500).json({ error: "Couldn't tick the sub-task" });
  }
});

export default router;
