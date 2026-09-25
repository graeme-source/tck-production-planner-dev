/**
 * Job titles on people (migration 0130) — the pure rules, tested.
 *
 * A job title is what someone DOES ("Production Operative", "Head Chef"),
 * shown on the People list and record. It is not the app permission role
 * (admin/manager/viewer) and nothing here touches that.
 */

export const JOB_TITLE_MAX = 120;

/** Tidy a typed title: trim, collapse inner whitespace, blank → null.
 *  Over-long input is cut at the limit rather than refused — the field
 *  autosaves as they type, and a hard refusal would lose the keystrokes. */
export function normaliseJobTitle(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const tidy = raw.replace(/\s+/g, " ").trim();
  if (tidy === "") return null;
  return tidy.slice(0, JOB_TITLE_MAX).trim();
}

/**
 * Issuing a contract with a different job title updates the person's title
 * (Graeme: "change that to what's in their contract"). Returns the title to
 * store, or null when nothing should change — same title (ignoring spacing),
 * or a blank title on the contract.
 */
export function jobTitleAfterIssue(current: string | null | undefined, issued: string | null | undefined): string | null {
  const next = normaliseJobTitle(issued);
  if (next == null) return null;
  return normaliseJobTitle(current) === next ? null : next;
}
