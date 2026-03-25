import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();

/**
 * POST /api/admin/apply-seed
 *
 * Accepts a prod-seed.sql file body (Content-Type: text/plain) and executes
 * it against the current database inside a single client connection.
 * Protected: admin session required (enforced by requireAdmin in routes/index.ts).
 *
 * Usage:
 *   curl -X POST https://YOUR_API/api/admin/apply-seed \
 *        -H 'Content-Type: text/plain' \
 *        --data-binary @scripts/prod-seed.sql \
 *        -b 'your_session_cookie'
 */
router.post("/apply-seed", async (req: Request, res: Response) => {
  let sqlBody: string;

  if (typeof req.body === "string" && req.body.trim().length > 0) {
    sqlBody = req.body;
  } else if (req.body && typeof req.body.sql === "string" && req.body.sql.trim().length > 0) {
    sqlBody = req.body.sql;
  } else {
    res.status(400).json({ error: "Request body must be the SQL seed file as text/plain, or JSON { sql: '...' }" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query(sqlBody);
    res.json({ ok: true, message: "Seed applied successfully." });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[apply-seed] Failed:", message);
    res.status(500).json({ error: "Seed failed", detail: message });
  } finally {
    client.release();
  }
});

export default router;
