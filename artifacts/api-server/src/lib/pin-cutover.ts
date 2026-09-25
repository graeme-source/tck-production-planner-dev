/**
 * The daily PIN cutover — the rule, no I/O.
 *
 * Every session must re-enter its PIN after each reset moment:
 *  - 04:00 UTC (the morning reset — always UTC, so 05:00 London in BST), and
 *  - 22:00 London (the evening reset — follows BST/GMT automatically).
 *
 * A session whose PIN was last verified before the most recent reset is
 * "PIN required". /api/auth/me reports it so the app shows the PIN pad, and
 * (since 2026-09-25) middleware/pin-enforce.ts refuses writes that record work
 * against a person until the PIN is entered — the lock used to exist only on
 * screen, which is how a session signed in as Grant the night before recorded
 * 16 building batches the next morning before Grant had arrived.
 *
 * Moved here from routes/auth.ts so the server lock and the auth route use the
 * one rule, and so it can be tested with a fixed clock.
 */
import { londonDateString } from "./london-time";

const LONDON_TZ = "Europe/London";
const MORNING_RESET_UTC_HOUR = 4;
const EVENING_RESET_LONDON_HOUR = 22;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" shifted by whole days (calendar arithmetic, no timezone). */
function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The UTC instant of `hour`:00 London wall-clock on the London date `dateStr`. */
function londonWallClock(dateStr: string, hour: number): Date {
  // London is UTC or UTC+1 on any given date. Probe midday UTC and ask London
  // what hour it thinks that is (same approach as lib/london-time.ts).
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const londonHour = Number.parseInt(
    new Intl.DateTimeFormat("en-GB", { timeZone: LONDON_TZ, hour: "2-digit", hourCycle: "h23" }).format(probe),
    10,
  );
  const offsetHours = londonHour - 12;
  const at = new Date(`${dateStr}T00:00:00Z`);
  at.setUTCHours(hour - offsetHours);
  return at;
}

/** Every reset instant from yesterday to tomorrow, sorted. */
function resetCandidates(now: Date): Date[] {
  const out: Date[] = [];
  for (const days of [-1, 0, 1]) {
    const morning = new Date(now.getTime() + days * DAY_MS);
    morning.setUTCHours(MORNING_RESET_UTC_HOUR, 0, 0, 0);
    out.push(morning);
    out.push(londonWallClock(shiftDate(londonDateString(now), days), EVENING_RESET_LONDON_HOUR));
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** The most recent reset at or before `now`, and the next one after it. */
export function pinResetWindow(now: Date = new Date()): { latest: Date; next: Date } {
  const candidates = resetCandidates(now);
  const t = now.getTime();
  let latest = candidates[0]!;
  let next = candidates[candidates.length - 1]!;
  for (const c of candidates) {
    if (c.getTime() <= t) latest = c;
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (candidates[i]!.getTime() > t) next = candidates[i]!;
  }
  return { latest, next };
}

/**
 * True when the session must re-enter its PIN: never verified, verified
 * before the most recent reset, or an unreadable timestamp (fail closed —
 * the answer is "type your PIN", never "carry on as whoever it was").
 */
export function isPinRequired(pinVerifiedAt: string | undefined | null, now: Date = new Date()): boolean {
  if (!pinVerifiedAt) return true;
  const verified = new Date(pinVerifiedAt).getTime();
  if (Number.isNaN(verified)) return true;
  return verified < pinResetWindow(now).latest.getTime();
}
