/**
 * Compatibility shim for the legacy /api/andon endpoints.
 *
 * @deprecated New code should use /api/improvements with type="issue".
 *
 * This file reads and writes to improvement_submissions (with type='issue')
 * and returns rows in the legacy andon_issues shape so existing callers
 * (dashboard banner, station badge) keep working during the migration to
 * the unified Issue Log. Once all callers have been migrated, this shim
 * can be deleted.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, improvementSubmissionsTable, usersTable } from "@workspace/db";
import { eq, isNull, desc, and, SQL } from "drizzle-orm";
import type { ImprovementSubmission } from "@workspace/db";

const router: IRouter = Router();

type LegacyAndon = {
  id: number;
  category: ImprovementSubmission["category"];
  severity: ImprovementSubmission["severity"];
  description: string | null;
  station: string;
  reportedBy: number | null;
  reportedByName: string | null;
  acknowledgedBy: number | null;
  acknowledgedByName: string | null;
  acknowledgedAt: Date | null;
  resolvedBy: number | null;
  resolvedByName: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

function toLegacy(row: ImprovementSubmission): LegacyAndon {
  return {
    id: row.id,
    category: row.category,
    severity: row.severity,
    description: row.description || null,
    station: row.station,
    reportedBy: row.submittedBy,
    reportedByName: row.submittedByName,
    acknowledgedBy: row.acknowledgedBy,
    acknowledgedByName: row.acknowledgedByName,
    acknowledgedAt: row.acknowledgedAt,
    resolvedBy: row.resolvedBy,
    resolvedByName: row.resolvedByName,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
  };
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const { station, category, severity, open } = req.query;
    const conditions: SQL[] = [eq(improvementSubmissionsTable.type, "issue")];
    if (station) conditions.push(eq(improvementSubmissionsTable.station, String(station)));
    if (category) conditions.push(eq(improvementSubmissionsTable.category, String(category) as NonNullable<ImprovementSubmission["category"]>));
    if (severity) conditions.push(eq(improvementSubmissionsTable.severity, String(severity) as NonNullable<ImprovementSubmission["severity"]>));
    if (open === "true") conditions.push(isNull(improvementSubmissionsTable.resolvedAt));

    const rows = await db
      .select()
      .from(improvementSubmissionsTable)
      .where(and(...conditions))
      .orderBy(desc(improvementSubmissionsTable.createdAt));

    res.json(rows.map(toLegacy));
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

    // Synthesize a title from category + severity — the legacy andon schema
    // didn't have a title but the unified table requires one.
    const title = description && description.trim()
      ? description.trim().slice(0, 80)
      : `${category} (${severity})`;

    const [row] = await db
      .insert(improvementSubmissionsTable)
      .values({
        title,
        description: description ?? "",
        station,
        type: "issue",
        category,
        severity,
        submittedBy: userId ?? null,
        submittedByName: reportedByName,
      })
      .returning();

    res.status(201).json(toLegacy(row));
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

    type UpdatePayload = Partial<Pick<
      ImprovementSubmission,
      "category" | "severity" | "description" | "station" | "updatedAt"
    >>;
    const updates: UpdatePayload = { updatedAt: new Date() };
    if (category !== undefined) updates.category = category;
    if (severity !== undefined) updates.severity = severity;
    if (description !== undefined) updates.description = description ?? "";
    if (station !== undefined) updates.station = station;

    if (Object.keys(updates).length === 1) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [row] = await db
      .update(improvementSubmissionsTable)
      .set(updates)
      .where(and(eq(improvementSubmissionsTable.id, id), eq(improvementSubmissionsTable.type, "issue")))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json(toLegacy(row));
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
      .update(improvementSubmissionsTable)
      .set({
        acknowledgedBy: userId ?? null,
        acknowledgedByName,
        acknowledgedAt: new Date(),
        progressStatus: "acknowledged",
        updatedAt: new Date(),
      })
      .where(and(eq(improvementSubmissionsTable.id, id), eq(improvementSubmissionsTable.type, "issue")))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json(toLegacy(row));
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
      .update(improvementSubmissionsTable)
      .set({
        resolvedBy: userId ?? null,
        resolvedByName,
        resolvedAt: new Date(),
        progressStatus: "complete",
        updatedAt: new Date(),
      })
      .where(and(eq(improvementSubmissionsTable.id, id), eq(improvementSubmissionsTable.type, "issue")))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json(toLegacy(row));
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
      .delete(improvementSubmissionsTable)
      .where(and(eq(improvementSubmissionsTable.id, id), eq(improvementSubmissionsTable.type, "issue")))
      .returning({ id: improvementSubmissionsTable.id });

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
