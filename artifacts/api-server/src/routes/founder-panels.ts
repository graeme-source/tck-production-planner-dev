import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

// Only the founder email may access these routes
const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

async function requireFounder(req: Request, res: Response, next: () => void) {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const rows = await db.execute<{ email: string }>(sql`SELECT email FROM app_users WHERE id = ${userId} LIMIT 1`);
  if (rows.rows[0]?.email !== FOUNDER_EMAIL) { res.status(403).json({ error: "Founder only" }); return; }
  next();
}

// GET /api/founder-panels
router.get("/", requireFounder, async (_req, res) => {
  const rows = await db.execute<{ id: number; tag: string; label: string; created_at: string }>(
    sql`SELECT id, tag, label, created_at FROM founder_custom_panels ORDER BY created_at ASC`
  );
  res.json(rows.rows);
});

// POST /api/founder-panels
router.post("/", requireFounder, async (req, res) => {
  const { tag, label } = req.body as { tag?: string; label?: string };
  if (!tag || typeof tag !== "string" || !tag.trim()) {
    res.status(400).json({ error: "tag is required" });
    return;
  }
  const trimmedTag = tag.trim();
  const trimmedLabel = (label?.trim() || trimmedTag);

  const rows = await db.execute<{ id: number; tag: string; label: string; created_at: string }>(sql`
    INSERT INTO founder_custom_panels (tag, label) VALUES (${trimmedTag}, ${trimmedLabel})
    RETURNING id, tag, label, created_at
  `);
  res.status(201).json(rows.rows[0]);
});

// DELETE /api/founder-panels/:id
router.delete("/:id", requireFounder, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.execute(sql`DELETE FROM founder_custom_panels WHERE id = ${id}`);
  res.json({ ok: true });
});

export default router;
