import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  db,
  complianceActionsTable,
  complianceActionCompletionsTable,
  riskAssessmentsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, asc, lte, gte, sql, inArray } from "drizzle-orm";
import { londonDateString, londonEndOfDay } from "../lib/london-time";

const router: IRouter = Router();

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session.userRole === "admin") { next(); return; }
  res.status(403).json({ error: "Admin access required" });
}

// ─── Recurrence helpers ─────────────────────────────────────────────────────

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
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return londonDateString();
}

async function resolveUserName(userId: number | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  return u?.name ?? null;
}

// ─── List / filter ───────────────────────────────────────────────────────────
// GET /api/compliance-actions?status=open&category=fire&assignedToUserId=3
router.get("/", async (req: Request, res: Response) => {
  try {
    const { status, category, riskAssessmentId, assignedToUserId } = req.query;
    const conds: any[] = [];
    if (status) conds.push(eq(complianceActionsTable.status, String(status)));
    if (category) conds.push(eq(complianceActionsTable.category, String(category)));
    if (riskAssessmentId) conds.push(eq(complianceActionsTable.riskAssessmentId, Number(riskAssessmentId)));
    if (assignedToUserId) conds.push(eq(complianceActionsTable.assignedToUserId, Number(assignedToUserId)));

    const rows = await db
      .select()
      .from(complianceActionsTable)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(complianceActionsTable.dueDate), desc(complianceActionsTable.priority));
    res.json(rows);
  } catch (err) {
    console.error("[compliance-actions] list error:", err);
    res.status(500).json({ error: "Failed to load compliance actions" });
  }
});

// ─── Dashboard — the to-do list view ─────────────────────────────────────────
// GET /api/compliance-actions/dashboard
// Returns { overdue: [], dueThisWeek: [], upcoming: [], assessments: [] }
router.get("/dashboard", async (_req: Request, res: Response) => {
  try {
    const today = todayIso();
    const inOneWeek = addDaysIso(new Date(), 7);
    const inThirtyDays = addDaysIso(new Date(), 30);

    // Fetch all open + in_progress actions with a due date
    const openActions = await db
      .select()
      .from(complianceActionsTable)
      .where(inArray(complianceActionsTable.status, ["open", "in_progress"]))
      .orderBy(asc(complianceActionsTable.dueDate));

    type Act = typeof openActions[number];
    const overdue = openActions.filter((a: Act) => a.dueDate !== null && a.dueDate < today);
    const dueThisWeek = openActions.filter((a: Act) => a.dueDate !== null && a.dueDate >= today && a.dueDate <= inOneWeek);
    const upcoming = openActions.filter((a: Act) => a.dueDate !== null && a.dueDate > inOneWeek && a.dueDate <= inThirtyDays);
    const unscheduled = openActions.filter((a: Act) => !a.dueDate);

    // Per-assessment counts
    const assessments = await db.select().from(riskAssessmentsTable).orderBy(asc(riskAssessmentsTable.title));
    type Ra = typeof assessments[number];
    const assessmentsWithCounts = assessments.map((ra: Ra) => {
      const raOpen = openActions.filter((a: Act) => a.riskAssessmentId === ra.id).length;
      const raOverdue = overdue.filter((a: Act) => a.riskAssessmentId === ra.id).length;
      return { ...ra, openCount: raOpen, overdueCount: raOverdue };
    });

    res.json({
      counts: {
        overdue: overdue.length,
        dueThisWeek: dueThisWeek.length,
        upcoming: upcoming.length,
        unscheduled: unscheduled.length,
      },
      overdue,
      dueThisWeek,
      upcoming,
      unscheduled,
      assessments: assessmentsWithCounts,
    });
  } catch (err) {
    console.error("[compliance-actions] dashboard error:", err);
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

// ─── Audit log (completion history) ──────────────────────────────────────────
// GET /api/compliance-actions/log?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns all completion events in the date range, joined with the action title.
router.get("/log", async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    const conds: any[] = [];
    if (from) conds.push(gte(complianceActionCompletionsTable.completedAt, new Date(String(from))));
    if (to) {
      conds.push(lte(complianceActionCompletionsTable.completedAt, londonEndOfDay(new Date(String(to)))));
    }
    const rows = await db
      .select({
        id: complianceActionCompletionsTable.id,
        completedAt: complianceActionCompletionsTable.completedAt,
        completedByName: complianceActionCompletionsTable.completedByName,
        notes: complianceActionCompletionsTable.notes,
        actionId: complianceActionCompletionsTable.actionId,
        actionTitle: complianceActionsTable.title,
        actionCategory: complianceActionsTable.category,
        actionRecurrence: complianceActionsTable.recurrence,
      })
      .from(complianceActionCompletionsTable)
      .innerJoin(complianceActionsTable, eq(complianceActionCompletionsTable.actionId, complianceActionsTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(complianceActionCompletionsTable.completedAt));
    res.json(rows);
  } catch (err) {
    console.error("[compliance-actions] log error:", err);
    res.status(500).json({ error: "Failed to load completion log" });
  }
});

// ─── Single ─────────────────────────────────────────────────────────────────

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [action] = await db.select().from(complianceActionsTable).where(eq(complianceActionsTable.id, id));
    if (!action) { res.status(404).json({ error: "Not found" }); return; }
    const history = await db
      .select()
      .from(complianceActionCompletionsTable)
      .where(eq(complianceActionCompletionsTable.actionId, id))
      .orderBy(desc(complianceActionCompletionsTable.completedAt));
    res.json({ ...action, history });
  } catch (err) {
    console.error("[compliance-actions] get error:", err);
    res.status(500).json({ error: "Failed to load action" });
  }
});

// ─── Create (admin) ─────────────────────────────────────────────────────────

router.post("/", requireAdmin, async (req: Request, res: Response) => {
  try {
    const {
      riskAssessmentId, title, description, category, priority,
      assignedToUserId, assignedToName, dueDate, recurrence, status,
    } = req.body;
    if (!title) { res.status(400).json({ error: "title is required" }); return; }

    const resolvedName = assignedToName ?? (assignedToUserId ? await resolveUserName(Number(assignedToUserId)) : null);

    const [row] = await db.insert(complianceActionsTable).values({
      riskAssessmentId: riskAssessmentId ?? null,
      title: String(title),
      description: description ?? null,
      category: category ?? "other",
      priority: priority ?? "medium",
      status: status ?? "open",
      assignedToUserId: assignedToUserId ?? null,
      assignedToName: resolvedName,
      dueDate: dueDate ?? null,
      recurrence: recurrence ?? "none",
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[compliance-actions] create error:", err);
    res.status(500).json({ error: "Failed to create action" });
  }
});

// ─── Update (admin) ─────────────────────────────────────────────────────────

router.patch("/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const {
      title, description, category, priority, status,
      assignedToUserId, assignedToName, dueDate, recurrence, riskAssessmentId,
    } = req.body;
    const updates: Partial<typeof complianceActionsTable.$inferInsert> = { updatedAt: new Date() };
    if (title !== undefined) updates.title = String(title);
    if (description !== undefined) updates.description = description;
    if (category !== undefined) updates.category = String(category);
    if (priority !== undefined) updates.priority = String(priority);
    if (status !== undefined) updates.status = String(status);
    if (assignedToUserId !== undefined) {
      updates.assignedToUserId = assignedToUserId;
      updates.assignedToName = assignedToName ?? (assignedToUserId ? await resolveUserName(Number(assignedToUserId)) : null);
    } else if (assignedToName !== undefined) {
      updates.assignedToName = assignedToName;
    }
    if (dueDate !== undefined) updates.dueDate = dueDate;
    if (recurrence !== undefined) updates.recurrence = String(recurrence);
    if (riskAssessmentId !== undefined) updates.riskAssessmentId = riskAssessmentId;

    const [row] = await db.update(complianceActionsTable).set(updates).where(eq(complianceActionsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[compliance-actions] update error:", err);
    res.status(500).json({ error: "Failed to update action" });
  }
});

// ─── Complete ────────────────────────────────────────────────────────────────
// Any authenticated user can mark an action complete. If the action is
// recurring, this also auto-creates the next instance with dueDate advanced
// by the recurrence period. Writes a row to the completion log.
router.post("/:id/complete", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { notes, completedAt, completedByName: explicitName } = req.body;
    const [action] = await db.select().from(complianceActionsTable).where(eq(complianceActionsTable.id, id));
    if (!action) { res.status(404).json({ error: "Not found" }); return; }
    if (action.status === "completed") { res.status(400).json({ error: "Action already completed" }); return; }

    const userId = req.session.userId ?? null;
    const completedByName = explicitName ?? (await resolveUserName(userId)) ?? "Unknown";
    const completedAtDate = completedAt ? new Date(completedAt) : new Date();

    // Decide whether to create a recurring next instance
    let nextActionId: number | null = null;
    if (action.recurrence && action.recurrence !== "none") {
      const days = RECURRENCE_DAYS[action.recurrence];
      if (days) {
        const baseForNext = action.dueDate ? new Date(action.dueDate + "T00:00:00") : completedAtDate;
        const nextDue = addDaysIso(baseForNext, days);
        const [nextRow] = await db.insert(complianceActionsTable).values({
          riskAssessmentId: action.riskAssessmentId,
          title: action.title,
          description: action.description,
          category: action.category,
          priority: action.priority,
          status: "open",
          assignedToUserId: action.assignedToUserId,
          assignedToName: action.assignedToName,
          dueDate: nextDue,
          recurrence: action.recurrence,
          parentActionId: action.parentActionId ?? action.id,
        }).returning({ id: complianceActionsTable.id });
        nextActionId = nextRow?.id ?? null;
      }
    }

    // Mark this action complete
    const [updated] = await db.update(complianceActionsTable).set({
      status: "completed",
      completedAt: completedAtDate,
      completedByUserId: userId,
      completedByName,
      completionNotes: notes ?? null,
      updatedAt: new Date(),
    }).where(eq(complianceActionsTable.id, id)).returning();

    // Write to completion log
    const [logRow] = await db.insert(complianceActionCompletionsTable).values({
      actionId: id,
      completedAt: completedAtDate,
      completedByUserId: userId,
      completedByName,
      notes: notes ?? null,
      nextActionId,
    }).returning();

    res.json({ action: updated, nextActionId, logId: logRow?.id });
  } catch (err) {
    console.error("[compliance-actions] complete error:", err);
    res.status(500).json({ error: "Failed to complete action" });
  }
});

// ─── Reschedule ─────────────────────────────────────────────────────────────

router.post("/:id/reschedule", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { dueDate } = req.body;
    if (!dueDate) { res.status(400).json({ error: "dueDate required" }); return; }
    const [row] = await db.update(complianceActionsTable).set({
      dueDate: String(dueDate),
      updatedAt: new Date(),
    }).where(eq(complianceActionsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[compliance-actions] reschedule error:", err);
    res.status(500).json({ error: "Failed to reschedule" });
  }
});

router.delete("/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await db.delete(complianceActionsTable).where(eq(complianceActionsTable.id, id));
    res.status(204).end();
  } catch (err) {
    console.error("[compliance-actions] delete error:", err);
    res.status(500).json({ error: "Failed to delete action" });
  }
});

export default router;
