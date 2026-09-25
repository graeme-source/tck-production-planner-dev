/**
 * Server-side lock for the People section (Graeme, 2026-09-24; compulsory
 * private PIN 2026-09-25).
 *
 * For anyone with People access (lib/people-access.ts):
 *   • no private PIN set yet → 428 + code "private_pin_required" — the app
 *     shows "Set your private PIN to open People". Access alone opens nothing.
 *   • private PIN set but not entered recently → 423 + code
 *     PEOPLE_PIN_REQUIRED — the app asks for the private PIN.
 *   • unlocked → through, and the window slides so active use never times
 *     out mid-read.
 *
 * Everyone without People access passes straight through: all that's left
 * for them behind these routes is their OWN record, and the routes refuse
 * anything else themselves. Access is read fresh on every request, so a
 * revoke bites on the next request even for someone already unlocked.
 * Rules + tests: lib/people-unlock.ts (peopleGateDecision).
 */
import type { Request, Response, NextFunction } from "express";
import { isPeopleUnlocked, peopleGateDecision, peopleGateRefusal } from "../lib/people-unlock";
import { peopleGateFacts } from "../lib/people-access";

export async function requirePeopleUnlock(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.session.userId;
  if (!userId) { next(); return; } // the app-wide guard answers unauthenticated requests
  try {
    const facts = await peopleGateFacts(userId);
    const now = new Date();
    const decision = peopleGateDecision({
      ...facts,
      unlocked: isPeopleUnlocked(req.session.peopleUnlockedAt, now),
    });
    const refusal = peopleGateRefusal(decision);
    if (refusal) { res.status(refusal.status).json(refusal.body); return; }
    if (facts.hasAccess) req.session.peopleUnlockedAt = now.toISOString();
    next();
  } catch (err) {
    console.error("[people-unlock] check failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Internal server error" });
  }
}
