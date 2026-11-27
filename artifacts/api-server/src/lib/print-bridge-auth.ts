/**
 * The print bridge's token check, shared by the prep-room label queue
 * (routes/print-jobs.ts) and the back-label runs (routes/back-label-jobs.ts).
 * The bridge is a headless script on a factory PC: it authenticates with
 * the PRINT_BRIDGE_TOKEN bearer, not a session. Unset token = closed, not open.
 */
import type { Request, Response, NextFunction } from "express";

export function requireBridgeToken(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.PRINT_BRIDGE_TOKEN;
  if (!expected) {
    res.status(503).json({ error: "PRINT_BRIDGE_TOKEN is not configured on the server" });
    return;
  }
  const got = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (got !== expected) {
    res.status(401).json({ error: "Bad bridge token" });
    return;
  }
  next();
}

// When each station's back-label bridge last called in — the "printer
// computer connected" light. In-memory is fine: a restarted server shows
// offline until the next poll (at most ~25 s).
const lastSeen = new Map<string, number>();

/** A bridge that hasn't called in for this long is treated as gone (it
 *  long-polls every ~25 s and reports every few seconds while printing). */
export const BRIDGE_ONLINE_MS = 60_000;

export function markBridgeSeen(station: string, now = Date.now()): void {
  lastSeen.set(station, now);
}

export function bridgeLastSeen(station: string): number | null {
  return lastSeen.get(station) ?? null;
}

export function isBridgeOnline(station: string, now = Date.now()): boolean {
  const at = lastSeen.get(station);
  return at != null && now - at < BRIDGE_ONLINE_MS;
}
