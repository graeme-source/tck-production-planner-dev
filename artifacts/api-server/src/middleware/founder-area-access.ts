/**
 * The door to the grantable parts of The Business (Graeme, 2026-09-29).
 *
 * requireFounderArea("founder.numbers") lets through the founder's account,
 * or an ACTIVE user who holds a grant of exactly that key (made by the
 * founder in Settings → Team & Access). Being an admin is not enough — the
 * rule is decideFounderFeatureAccess in @workspace/feature-registry, shared
 * with the screen.
 *
 * Looked up fresh on every request (no caching), so taking a grant away
 * works on the next click. Anything that goes wrong is a refusal, never a
 * silent pass.
 */
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { decideFounderFeatureAccess, isFounderOnlyFeature, type FounderFeatureKey } from "@workspace/feature-registry";
import { allowedFeatureKeys } from "../lib/feature-access";

export function requireFounderArea(featureKey: FounderFeatureKey | readonly FounderFeatureKey[]) {
  // Several keys = any one of them opens the door (e.g. revenue targets are
  // shown on both Numbers and Sales & Marketing).
  const keys: readonly FounderFeatureKey[] = typeof featureKey === "string" ? [featureKey] : featureKey;
  // A typo here would otherwise quietly become "founder only" — say so at boot.
  for (const k of keys) {
    if (!isFounderOnlyFeature(k)) {
      throw new Error(`requireFounderArea: ${k} is not a founder-only feature`);
    }
  }
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.session.userId;
    if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
    try {
      const rows = await db.execute<{ email: string | null; is_active: boolean | null }>(
        sql`SELECT email, is_active FROM app_users WHERE id = ${userId} LIMIT 1`,
      );
      const user = rows.rows[0];
      if (!user || user.is_active === false) { res.status(403).json({ error: "Founder only" }); return; }
      // Same grant list the screen gets in /auth/me (SOP gate included), so
      // the page and the API can't disagree about a grant.
      const grantedKeys = await allowedFeatureKeys(userId);
      if (keys.some(k => decideFounderFeatureAccess({ email: user.email, grantedKeys, featureKey: k }))) { next(); return; }
      res.status(403).json({ error: "Founder only" });
    } catch (err) {
      console.error("[requireFounderArea] lookup failed:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
