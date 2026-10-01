/**
 * To-dos on the marketing calendar (Graeme, 2026-10-01). Objective I — the
 * founder and the marketing team see what each of them has on, day by day,
 * beside the phases and emails.
 *
 * PRIVACY (server-enforced, decideTodoViewers in @workspace/marketing-calendar):
 * everyone gets ONLY their own to-dos from here. The one exception is the
 * founder, who may switch on the to-dos of the other people who use this
 * calendar (anyone holding the Sales & Marketing grant). Anyone else asking
 * for someone else's to-dos gets 403 — nothing is silently dropped.
 *
 * Read-only: ticking off and editing happen in the to-do sheet
 * (routes/todos.ts), which keeps its own permissions.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { FOUNDER_FEATURES, isFounderEmail } from "@workspace/feature-registry";
import { daysBetween, decideTodoViewers, parseIdList, todosInRange } from "@workspace/marketing-calendar";
import { validateQuery } from "../middleware/validate";
import { requireFounderArea } from "../middleware/founder-area-access";
import { allowedFeatureKeys } from "../lib/feature-access";

const router: IRouter = Router();
router.use(requireFounderArea(FOUNDER_FEATURES.sales));

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const Query = z.object({
  from: IsoDate,
  to: IsoDate,
  /** Other people's ids, comma-separated ("9,14") — founder only. */
  people: z.string().max(200).regex(/^[\d,\s]*$/, "people is a list of ids").optional(),
})
  .refine(q => q.to >= q.from, { message: "to must be on or after from" })
  .refine(q => daysBetween(q.from, q.to) <= 800, { message: "Range too long (max ~2 years)" });

/** The other people who can open the marketing calendar (founder excluded —
 *  the founder sees the calendar by being the founder, not by a grant). */
async function calendarPeople(excludeId: number): Promise<Array<{ id: number; name: string }>> {
  const rows = await db.execute<{ id: number; name: string; email: string | null }>(sql`
    SELECT u.id, u.name, u.email
    FROM feature_grants g
    JOIN app_users u ON u.id = g.user_id
    WHERE g.feature_key = ${FOUNDER_FEATURES.sales}
      AND u.is_active IS NOT FALSE
      AND u.id <> ${excludeId}
    ORDER BY u.name
  `);
  const out: Array<{ id: number; name: string }> = [];
  for (const r of rows.rows) {
    if (isFounderEmail(r.email)) continue;
    // Same answer the door gives (SOP gate included): a grant that doesn't
    // currently open the calendar doesn't put someone on this list.
    if ((await allowedFeatureKeys(r.id)).includes(FOUNDER_FEATURES.sales)) out.push({ id: r.id, name: r.name });
  }
  return out;
}

interface TodoRow {
  [key: string]: unknown;
  id: number;
  assignee_id: number;
  assignee_name: string | null;
  title: string;
  priority: string;
  status: string;
  due_date: string | null;
  scheduled_for: string | null;
}

router.get("/", validateQuery(Query), async (req: Request, res: Response) => {
  const { from, to, people } = res.locals["query"] as z.infer<typeof Query>;
  const viewerId = req.session.userId!;
  try {
    const me = await db.execute<{ email: string | null }>(sql`SELECT email FROM app_users WHERE id = ${viewerId} LIMIT 1`);
    const viewerIsFounder = isFounderEmail(me.rows[0]?.email);
    const requestedIds = parseIdList(people);
    const others = viewerIsFounder ? await calendarPeople(viewerId) : [];

    const decision = decideTodoViewers({
      viewerId, viewerIsFounder, requestedIds, calendarPeopleIds: others.map(p => p.id),
    });
    if (!decision.ok) { res.status(403).json({ error: decision.reason }); return; }

    // DATE columns read back as text: they are already the London calendar
    // day, and a JS Date would shift them by the server's timezone.
    const rows = await db.execute<TodoRow>(sql`
      SELECT t.id, t.assignee_id, au.name AS assignee_name, t.title, t.priority, t.status,
             to_char(t.due_date, 'YYYY-MM-DD') AS due_date,
             to_char(t.scheduled_for, 'YYYY-MM-DD') AS scheduled_for
      FROM todo_tasks t
      LEFT JOIN app_users au ON au.id = t.assignee_id
      WHERE t.assignee_id IN (${sql.join(decision.userIds.map(id => sql`${id}`), sql`, `)})
        AND (
          (t.due_date BETWEEN ${from}::date AND ${to}::date)
          OR (t.due_date IS NULL AND t.scheduled_for BETWEEN ${from}::date AND ${to}::date)
        )
      ORDER BY t.id
    `);
    const todos = todosInRange(
      rows.rows.map(r => ({ ...r, dueDate: r.due_date, scheduledFor: r.scheduled_for })),
      from, to,
    ).map(t => ({
      id: t.id,
      title: t.title,
      date: t.date,
      dateKind: t.dateKind,
      priority: t.priority,
      done: t.status === "done",
      assignee: { id: t.assignee_id, name: t.assignee_name ?? "Someone" },
      mine: t.assignee_id === viewerId,
    }));

    res.json({
      viewerId,
      // Only the founder learns who else could be switched on.
      canViewOthers: viewerIsFounder,
      people: others,
      todos,
    });
  } catch (err) {
    console.error("[marketing-todos] list failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Couldn't load to-dos" });
  }
});

export default router;
