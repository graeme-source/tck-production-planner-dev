/**
 * The founder gate: some surfaces are the founder's own, and a role check
 * isn't enough — the ACCOUNT has to be his. An admin is not the founder.
 *
 * This was copy-pasted into four routers before it lived anywhere (pnl.ts,
 * founder-panels.ts, founder-focus.ts, and nearly meta-ads.ts). One copy,
 * here. A DB failure is a 500, never a silent pass.
 */
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { FOUNDER_EMAIL } from "../lib/founder-email";

export { FOUNDER_EMAIL };

export async function requireFounder(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const rows = await db.execute<{ email: string }>(
      sql`SELECT email FROM app_users WHERE id = ${userId} LIMIT 1`,
    );
    if (rows.rows[0]?.email !== FOUNDER_EMAIL) {
      res.status(403).json({ error: "Founder only" });
      return;
    }
    next();
  } catch (err) {
    console.error("[requireFounder] lookup failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Internal server error" });
  }
}
