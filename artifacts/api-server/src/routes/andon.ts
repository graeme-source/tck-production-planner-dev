import { Router, type IRouter, type Request, type Response } from "express";
import { db, andonIssuesTable, usersTable } from "@workspace/db";
import { eq, isNull, desc, and, SQL } from "drizzle-orm";
import type { AndonIssue } from "@workspace/db";

const router: IRouter = Router();

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
    const { category, severity, description, station } = req.body;
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

export default router;
