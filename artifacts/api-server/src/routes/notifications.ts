import { Router, type Request, type Response } from "express";
import { db, notificationsTable } from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";

const router = Router();

// GET /api/notifications — current user's notifications (newest first)
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, userId))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(50);
    res.json(rows);
  } catch (err) {
    console.error("Error fetching notifications:", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// GET /api/notifications/unread-count — lightweight count for bell badge
router.get("/unread-count", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const [row] = await db
      .select({ value: count() })
      .from(notificationsTable)
      .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.read, false)));
    res.json({ count: row?.value ?? 0 });
  } catch (err) {
    console.error("Error fetching unread count:", err);
    res.status(500).json({ error: "Failed to fetch unread count" });
  }
});

// PATCH /api/notifications/:id/read — mark one notification as read
router.patch("/:id/read", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [row] = await db
      .update(notificationsTable)
      .set({ read: true })
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)))
      .returning();

    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("Error marking notification read:", err);
    res.status(500).json({ error: "Failed to mark notification read" });
  }
});

// PATCH /api/notifications/read-all — mark all as read for current user
router.patch("/read-all", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    await db
      .update(notificationsTable)
      .set({ read: true })
      .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.read, false)));
    res.json({ success: true });
  } catch (err) {
    console.error("Error marking all notifications read:", err);
    res.status(500).json({ error: "Failed to mark all read" });
  }
});

export default router;
