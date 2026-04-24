import { Router, type Request, type Response, type NextFunction } from "express";
import { db, notificationsTable, usersTable } from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";

const router = Router();

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session.userRole === "admin") { next(); return; }
  res.status(403).json({ error: "Admin access required" });
}

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

// POST /api/notifications/broadcast — admin-only fan-out. Inserts a row per
// active user so the standard per-user list / unread-count endpoints keep
// working unchanged, and the recipient can dismiss their own copy without
// affecting anyone else's. Typical use: "please refresh your browser to pick
// up the latest version." Body: { message: string, type?: string }.
router.post("/broadcast", requireAdmin, async (req: Request, res: Response) => {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const type = typeof req.body?.type === "string" && req.body.type.length > 0
      ? req.body.type
      : "broadcast";
    if (!message) { res.status(400).json({ error: "message is required" }); return; }
    if (message.length > 500) { res.status(400).json({ error: "message too long (max 500 chars)" }); return; }

    const users = await db.select({ id: usersTable.id }).from(usersTable);
    if (users.length === 0) { res.json({ sent: 0 }); return; }

    const rows = users.map(u => ({
      userId: u.id,
      type,
      message,
      andonIssueId: null,
      read: false,
    }));
    await db.insert(notificationsTable).values(rows);

    res.json({ sent: rows.length });
  } catch (err) {
    console.error("Error broadcasting notification:", err);
    res.status(500).json({ error: "Failed to broadcast" });
  }
});

export default router;
