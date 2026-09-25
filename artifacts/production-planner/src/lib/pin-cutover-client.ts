/**
 * When the daily PIN cutover (4am UTC / 10pm London) actually locks the
 * screen — the rule, no I/O. Used by contexts/auth-context.tsx.
 *
 * The cutover used to be deferred whenever the person had been "active"
 * inside the screen's idle allowance. That was meant to protect someone
 * typing across 10pm (Graeme lost a half-built recipe to the cutover,
 * 2026-08-20) — but the first taps on an iPad woken in the morning are
 * activity too, so the lock never landed. Fri 25 Sep 2026: an iPad signed in
 * as Grant from the night before was woken at 07:29, opened Table 2 and
 * recorded 16 building batches under Grant's name before he'd arrived.
 *
 * The rule now: defer ONLY for activity that was already going on before the
 * reset and has carried on without a break since. Anything that happened
 * after the reset — the taps that wake a sleeping iPad — never counts.
 *
 * "Without a break" is tracked as an activity streak: the streak starts on
 * the first touch after a gap of CUTOVER_CONTINUITY_MS or more, and carries
 * on while touches keep coming inside that gap.
 */

/** A pause this long breaks the streak. Deliberately the app's default idle
 *  allowance (15 min), NOT the per-station allowance — a watched screen may
 *  be allowed hours without a tap before the idle lock, but hours without a
 *  tap is not "working across the cutover". */
export const CUTOVER_CONTINUITY_MS = 15 * 60 * 1000;

/**
 * The start of the current activity streak after a touch at `now`.
 * A first-ever touch, or one after a gap of `gapMs` or more, starts a new
 * streak; otherwise the existing streak carries on.
 */
export function nextStreakStart(
  prev: { lastActivity: number; streakStart: number },
  now: number,
  gapMs: number = CUTOVER_CONTINUITY_MS,
): number {
  if (!prev.streakStart || !prev.lastActivity) return now;
  if (now - prev.lastActivity >= gapMs) return now;
  return prev.streakStart;
}

export type CutoverDeferInput = {
  now: number;
  /** The reset that made the PIN required (ms). Unknown → never defer. */
  resetAt: number | null;
  /** Most recent activity on this device, any tab (ms, 0 = none). */
  lastActivity: number;
  /** Start of the current activity streak (ms, 0 = none). */
  streakStart: number;
  /** A PIN lock has already been put up on this device — it stays up. */
  lockAlreadyApplied: boolean;
  continuityMs?: number;
};

/**
 * True when a required cutover should WAIT because the person was genuinely
 * working across the reset moment and still is. False means lock now.
 */
export function shouldDeferCutover(i: CutoverDeferInput): boolean {
  if (i.lockAlreadyApplied) return false;
  if (i.resetAt == null || !Number.isFinite(i.resetAt)) return false;
  const gap = i.continuityMs ?? CUTOVER_CONTINUITY_MS;
  if (!i.lastActivity || i.now - i.lastActivity >= gap) return false; // not active now
  // The streak must have begun BEFORE the reset. Waking a device after the
  // reset starts a fresh streak, so it can never qualify.
  return i.streakStart > 0 && i.streakStart < i.resetAt;
}

/**
 * Local check for the moment a screen wakes, focuses or is shown again —
 * before any server round-trip, and before the person's first tap can make
 * them look "active". `nextResetAt` is the reset the server last said was
 * coming (pinNextResetAt from /api/auth/me). True = lock immediately.
 */
export function cutoverPassedWhileAway(i: {
  now: number;
  nextResetAt: number | null;
  lastActivity: number;
  streakStart: number;
  lockAlreadyApplied: boolean;
  continuityMs?: number;
}): boolean {
  if (i.nextResetAt == null || !Number.isFinite(i.nextResetAt)) return false;
  if (i.now < i.nextResetAt) return false;
  return !shouldDeferCutover({ ...i, resetAt: i.nextResetAt });
}
