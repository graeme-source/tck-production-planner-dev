/**
 * How long a screen may sit untouched before it PIN-locks.
 *
 * One global fifteen minutes used to govern the whole app, which is wrong in
 * both directions at once (Graeme, 2026-08-26). Dough Prep and Dough Sheeting
 * are *read* constantly and *touched* rarely — the screen is a reference while
 * both hands are busy — so fifteen minutes means locking someone out of a
 * screen they're actively looking at. Packing is the opposite: the iPad gets
 * used briefly and then left, sometimes for hours, logged in as whoever last
 * touched it.
 *
 * So the timeout belongs to the station, not the app. Anything not named uses
 * the default, which keeps the old behaviour everywhere nobody has thought
 * about yet.
 */

/** Minutes, keyed by station. `default` covers everything else. */
export type IdleTimeoutSettings = Record<string, number>;

/** What ships until someone changes it in Settings. */
export const DEFAULT_IDLE_TIMEOUTS: IdleTimeoutSettings = {
  default: 15,
  // Watched, not touched — three hours, so a shift can run without a lock.
  dough_prep: 180,
  dough_sheeting: 180,
};

/** Bounds. Below one minute nobody could work; above twelve hours a shift has
 *  ended and an unlocked iPad on a bench is a different problem. */
export const MIN_IDLE_MINUTES = 1;
export const MAX_IDLE_MINUTES = 720;

/**
 * The station a path belongs to, or null for the rest of the app.
 * Station routes look like /plans/123/station/dough_prep.
 */
export function stationFromPath(path: string): string | null {
  const match = /\/station\/([a-z0-9_]+)/i.exec(path);
  return match ? match[1]!.toLowerCase() : null;
}

/** Clamp to something sane, falling back when a value is missing or junk. */
function sane(minutes: unknown, fallback: number): number {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_IDLE_MINUTES, Math.max(MIN_IDLE_MINUTES, Math.round(n)));
}

/** Minutes of inactivity allowed on this path. */
export function idleTimeoutMinutes(path: string, settings: IdleTimeoutSettings | null | undefined): number {
  const merged = { ...DEFAULT_IDLE_TIMEOUTS, ...(settings ?? {}) };
  const fallback = sane(merged.default, DEFAULT_IDLE_TIMEOUTS.default!);
  const station = stationFromPath(path);
  if (!station) return fallback;
  // A station with no entry of its own follows the default rather than
  // inheriting whatever another station was set to.
  return station in merged ? sane(merged[station], fallback) : fallback;
}

/** The same answer in milliseconds, which is what the idle check compares. */
export function idleTimeoutMs(path: string, settings: IdleTimeoutSettings | null | undefined): number {
  return idleTimeoutMinutes(path, settings) * 60_000;
}
