/**
 * Server-side lock for the People section (Graeme, 2026-09-24).
 *
 * Applies ONLY to someone who has set a private PIN: their session must have
 * unlocked People with it recently (lib/people-unlock.ts), otherwise the
 * request is refused with 423 + code PEOPLE_PIN_REQUIRED and the app asks
 * for the private PIN. Each allowed request slides the window forward, so
 * active use never times out mid-read.
 *
 * Everyone without a private PIN passes straight through — for them nothing
 * changes. Who may see people data at all is still decided by the routes
 * themselves (PEOPLE_DATA_EMAILS etc.); this only adds the second key.
 */
import type { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isPeopleUnlocked } from "../lib/people-unlock";

export async function requirePeopleUnlock(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.session.userId;
  if (!userId) { next(); return; } // the app-wide guard answers unauthenticated requests
  try {
    const [u] = await db.select({ privatePinHash: usersTable.privatePinHash }).from(usersTable).where(eq(usersTable.id, userId));
    if (!u?.privatePinHash) { next(); return; }
    const now = new Date();
    if (!isPeopleUnlocked(req.session.peopleUnlockedAt, now)) {
      res.status(423).json({ error: "Enter your private PIN to open People", code: "PEOPLE_PIN_REQUIRED" });
      return;
    }
    req.session.peopleUnlockedAt = now.toISOString();
    next();
  } catch (err) {
    console.error("[people-unlock] check failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Internal server error" });
  }
}
