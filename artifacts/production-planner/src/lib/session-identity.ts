/**
 * Should the app's cached data be wiped for this identity change?
 *
 * The station PCs are shared: people swap in and out by PIN all day. Cached
 * queries (to-do lists, notifications, the "you've been asked to…" takeover)
 * are keyed the same for everyone, so without a wipe the previous person's
 * data keeps rendering under the new person's name until the next scheduled
 * refetch — that's how Lorna's to-dos showed on Major's packing screen
 * (Graeme, 2026-09-04).
 *
 * Wipe when one signed-in person is replaced by a different one, and on
 * sign-out (the next person must start clean). Don't wipe on first load
 * (nothing cached yet) or when the same person re-verifies — the daily PIN
 * lock re-confirms the SAME user, and clearing there would cost a full
 * refetch of every screen several times a day for no privacy gain.
 */
export function shouldResetCachesOnIdentityChange(
  previousUserId: number | null,
  nextUserId: number | null,
): boolean {
  if (previousUserId === null) return false;   // first sign-in of the session
  if (nextUserId === null) return true;        // signed out — leave nothing behind
  return previousUserId !== nextUserId;        // a different person took over
}
