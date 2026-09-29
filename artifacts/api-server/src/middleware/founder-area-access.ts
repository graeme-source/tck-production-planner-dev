/**
 * The founder area, opened up one feature at a time.
 *
 * Some founder pages are no longer the founder's alone: Sales & Marketing is
 * planned together with the marketing team (Graeme, 2026-09-29). Access is
 * the founder's account OR a Settings → Team & Access grant of that feature
 * key (feature_grants) to an ACTIVE account. An admin role on its own does
 * not open the founder area — it has to be handed out by name.
 *
 * A DB failure is a 500, never a silent pass (same posture as requireFounder).
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { isFounderEmail } from "../lib/founder-email";

export function requireFounderArea(featureKey: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.session.userId;
    if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
    try {
      const rows = await db.execute<{ email: string; is_active: boolean; granted: boolean }>(sql`
        SELECT u.email, u.is_active,
               EXISTS (SELECT 1 FROM feature_grants g WHERE g.user_id = u.id AND g.feature_key = ${featureKey}) AS granted
        FROM app_users u WHERE u.id = ${userId} LIMIT 1
      `);
      const row = rows.rows[0];
      if (row && isFounderEmail(row.email)) { next(); return; }
      if (row && row.is_active && row.granted) { next(); return; }
      res.status(403).json({ error: "You don't have access to this part of the founder area" });
    } catch (err) {
      console.error("[requireFounderArea] lookup failed:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
