/**
 * The optional note on a station break (Fix queue #61) — e.g. "called back
 * for APC" when a lunch had to be interrupted. Pure, so it is unit-tested.
 */

export const BREAK_NOTE_MAX_LENGTH = 500;

/** Trim; blank → null (no note). Over-long text is cut to the limit. */
export function normaliseBreakNote(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t) return null;
  return t.slice(0, BREAK_NOTE_MAX_LENGTH);
}

/** Who may write the note: the person on the break, anyone on a legacy break
 *  with no owner, or a manager/admin. */
export function canEditBreakNote(
  breakUserId: number | null,
  sessionUserId: number | null,
  sessionRole: string | null,
): boolean {
  if (sessionRole === "admin" || sessionRole === "manager") return true;
  return breakUserId == null || (sessionUserId != null && breakUserId === sessionUserId);
}
