import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireFounderArea } from "../middleware/founder-area-access";

const router: IRouter = Router();

// The custom tag panels on the Numbers page: the founder, or someone he has
// granted Business Numbers to (Graeme, 2026-09-29). Admin alone isn't enough.
const requireNumbers = requireFounderArea("founder.numbers");

// GET /api/founder-panels
router.get("/", requireNumbers, async (_req, res) => {
  const rows = await db.execute<{ id: number; tag: string; label: string; created_at: string }>(
    sql`SELECT id, tag, label, created_at FROM founder_custom_panels ORDER BY created_at ASC`
  );
  res.json(rows.rows);
});

// POST /api/founder-panels
router.post("/", requireNumbers, async (req, res) => {
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
router.delete("/:id", requireNumbers, async (req: Request<{ id: string }>, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.execute(sql`DELETE FROM founder_custom_panels WHERE id = ${id}`);
  res.json({ ok: true });
});

export default router;
