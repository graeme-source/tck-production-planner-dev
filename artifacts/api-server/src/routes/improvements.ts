import { Router, type IRouter, type Request, type Response } from "express";
import { db, improvementSubmissionsTable, improvementCommentsTable, usersTable } from "@workspace/db";
import { eq, isNull, desc, asc, and, SQL } from "drizzle-orm";
import type { ImprovementSubmission } from "@workspace/db";

const router: IRouter = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const { type, station, open } = req.query;
    const conditions: SQL[] = [];
    if (type) conditions.push(eq(improvementSubmissionsTable.type, String(type)));
    if (station) conditions.push(eq(improvementSubmissionsTable.station, String(station)));
    if (open === "true") conditions.push(isNull(improvementSubmissionsTable.resolvedAt));

    const rows = await db
      .select()
      .from(improvementSubmissionsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(improvementSubmissionsTable.createdAt));
    res.json(rows);
  } catch (err) {
    console.error("Error fetching improvement submissions:", err);
    res.status(500).json({ error: "Failed to fetch improvement submissions" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { title, description, station, type, category, severity } = req.body;
    if (!title || !station) {
      res.status(400).json({ error: "title and station are required" });
      return;
    }

    const submissionType: string =
      type === "struggle" ? "struggle" : type === "issue" ? "issue" : "improvement";

    if (submissionType === "issue" && (!category || !severity)) {
      res.status(400).json({ error: "category and severity are required for issues" });
      return;
    }

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
        description: description ?? "",
        station,
        type: submissionType,
        category: submissionType === "issue" ? category : null,
        severity: submissionType === "issue" ? severity : null,
        submittedBy: userId ?? null,
        submittedByName,
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

    const { approvalTier, progressStatus, notes, category, severity, description, station, title } = req.body;

    type UpdatePayload = Partial<Pick<
      ImprovementSubmission,
      "approvalTier" | "progressStatus" | "notes" | "category" | "severity" | "description" | "station" | "title" | "updatedAt"
    >>;
    const updates: UpdatePayload = { updatedAt: new Date() };
    if (approvalTier !== undefined) updates.approvalTier = approvalTier;
    if (progressStatus !== undefined) updates.progressStatus = progressStatus;
    if (notes !== undefined) updates.notes = notes;
    if (category !== undefined) updates.category = category;
    if (severity !== undefined) updates.severity = severity;
    if (description !== undefined) updates.description = description;
    if (station !== undefined) updates.station = station;
    if (title !== undefined) updates.title = title;

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
      .update(improvementSubmissionsTable)
      .set({
        acknowledgedBy: userId ?? null,
        acknowledgedByName,
        acknowledgedAt: new Date(),
        progressStatus: "acknowledged",
        updatedAt: new Date(),
      })
      .where(eq(improvementSubmissionsTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json(row);
  } catch (err) {
    console.error("Error acknowledging improvement submission:", err);
    res.status(500).json({ error: "Failed to acknowledge improvement submission" });
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
      .update(improvementSubmissionsTable)
      .set({
        resolvedBy: userId ?? null,
        resolvedByName,
        resolvedAt: new Date(),
        progressStatus: "complete",
        updatedAt: new Date(),
      })
      .where(eq(improvementSubmissionsTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json(row);
  } catch (err) {
    console.error("Error resolving improvement submission:", err);
    res.status(500).json({ error: "Failed to resolve improvement submission" });
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

// --- Comments -----------------------------------------------------------

router.get("/:id/comments", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const rows = await db
      .select()
      .from(improvementCommentsTable)
      .where(eq(improvementCommentsTable.submissionId, id))
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
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const { comment } = req.body;
    if (!comment || typeof comment !== "string" || !comment.trim()) {
      res.status(400).json({ error: "comment text is required" });
      return;
    }

    // Verify submission exists
    const [existing] = await db
      .select({ id: improvementSubmissionsTable.id })
      .from(improvementSubmissionsTable)
      .where(eq(improvementSubmissionsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }

    const userId = req.session.userId;
    let userName: string | null = null;
    if (userId) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      userName = user?.name ?? null;
    }

    const [row] = await db
      .insert(improvementCommentsTable)
      .values({
        submissionId: id,
        userId: userId ?? null,
        userName,
        comment: comment.trim(),
      })
      .returning();

    res.status(201).json(row);
  } catch (err) {
    console.error("Error adding comment:", err);
    res.status(500).json({ error: "Failed to add comment" });
  }
});

export default router;
