import { Router, type IRouter, type Request, type Response } from "express";
import { db, improvementSubmissionsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import type { ImprovementSubmission } from "@workspace/db";

const router: IRouter = Router();

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
    const { title, description, station, type } = req.body;
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

    const { approvalTier, progressStatus, notes } = req.body;

    type UpdatePayload = Partial<Pick<ImprovementSubmission, "approvalTier" | "progressStatus" | "notes" | "updatedAt">>;
    const updates: UpdatePayload = { updatedAt: new Date() };
    if (approvalTier !== undefined) updates.approvalTier = approvalTier;
    if (progressStatus !== undefined) updates.progressStatus = progressStatus;
    if (notes !== undefined) updates.notes = notes;

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

export default router;
