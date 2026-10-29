/**
 * Server lock on your OWN HR records (rules: lib/hub-unlock.ts). Mounted on
 * the own-record routes; routes shared with HR (a signed PDF the founder
 * also opens) call hubUnlockPasses() only when the reader is the owner, so
 * HR's own access rules are untouched.
 */
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { HUB_PIN_REFUSAL, hubGateDecision, isHubUnlocked } from "../lib/hub-unlock";
import { isPeopleUnlocked, peopleGateDecision, peopleGateRefusal } from "../lib/people-unlock";
import { peopleGateFacts } from "../lib/people-access";

/** True when the request may go on (the window slides); otherwise the
 *  refusal has been sent. */
export async function hubUnlockPasses(req: Request, res: Response): Promise<boolean> {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return false; }
  try {
    const facts = await peopleGateFacts(userId);
    const u = (await db.execute<{ has_pin: boolean; onboarding: boolean }>(sql`
      SELECT (pin_hash IS NOT NULL) AS has_pin,
             (onboarding_required AND onboarding_completed_at IS NULL) AS onboarding
        FROM app_users WHERE id = ${userId} LIMIT 1
    `)).rows[0];
    const now = new Date();
    const decision = hubGateDecision({
      hasPeopleAccess: facts.hasAccess,
      onboarding: u?.onboarding === true,
      hasStationPin: u?.has_pin === true,
      unlocked: isHubUnlocked(req.session.hubUnlockedAt, now),
    });
    if (decision === "people") {
      const refusal = peopleGateRefusal(peopleGateDecision({ ...facts, unlocked: isPeopleUnlocked(req.session.peopleUnlockedAt, now) }));
      if (refusal) { res.status(refusal.status).json(refusal.body); return false; }
      req.session.peopleUnlockedAt = now.toISOString();
      return true;
    }
    if (decision === "locked") { res.status(HUB_PIN_REFUSAL.status).json(HUB_PIN_REFUSAL.body); return false; }
    if (isHubUnlocked(req.session.hubUnlockedAt, now)) req.session.hubUnlockedAt = now.toISOString();
    return true;
  } catch (err) {
    console.error("[hub-unlock] check failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Internal server error" });
    return false;
  }
}

export async function requireHubUnlock(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (await hubUnlockPasses(req, res)) next();
}
