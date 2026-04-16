import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  db,
  riskAssessmentsTable,
  complianceActionsTable,
  complianceActionCompletionsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, isNull, sql, asc, desc, gte, lte, inArray, ne } from "drizzle-orm";

const router: IRouter = Router();

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
  return new Date().toISOString().slice(0, 10);
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
      .select()
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
    const [ra] = await db.select().from(riskAssessmentsTable).where(eq(riskAssessmentsTable.id, id));
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

router.post("/", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { assessmentType, title, bodyMarkdown, status, reviewFrequencyMonths } = req.body;
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
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[risk-assessments] create error:", err);
    res.status(500).json({ error: "Failed to create risk assessment" });
  }
});

router.patch("/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { title, bodyMarkdown, status, reviewFrequencyMonths, assessmentType } = req.body;
    const updates: Partial<typeof riskAssessmentsTable.$inferInsert> = { updatedAt: new Date() };
    if (title !== undefined) updates.title = String(title);
    if (bodyMarkdown !== undefined) updates.bodyMarkdown = String(bodyMarkdown);
    if (status !== undefined) updates.status = String(status);
    if (assessmentType !== undefined) updates.assessmentType = String(assessmentType);
    if (reviewFrequencyMonths !== undefined) updates.reviewFrequencyMonths = Number(reviewFrequencyMonths);
    const [row] = await db.update(riskAssessmentsTable).set(updates).where(eq(riskAssessmentsTable.id, id)).returning();
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
