/**
 * The print bridge's two endpoints (GET /pending, POST /:id/complete) are
 * called by a headless script with a bearer token, not a session cookie, so
 * they have to be reachable above the app-wide login guard (Graeme,
 * 2026-10-22: first real bridge run got 401 "Not authenticated" on every
 * poll). Everything else under /print-jobs stays behind the guard and the
 * PIN lock. Paths are relative to the /print-jobs mount.
 */
export function isPrintBridgePath(path: string): boolean {
  return /^\/(pending|\d+\/complete)\/?$/.test(path);
}

/**
 * A label request older than this is never printed: a label that comes out
 * hours or weeks after the tap carries the wrong opened-on and use-by dates
 * (Graeme, 2026-10-22: the first bridge run printed four September requests
 * that had sat queued since staff tapped them). Expired requests stay in the
 * table, marked 'expired', for the audit trail.
 */
export const PRINT_JOB_MAX_AGE_MINUTES = 15;

export function isPrintJobStale(createdAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - createdAt.getTime() > PRINT_JOB_MAX_AGE_MINUTES * 60_000;
}
