/**
 * Who a note is shared with — three levels (Graeme, 2026-10-14: "I want a
 * double confirmation… It might be a draft version that we're not willing to
 * share yet… I also want the ability for me to share with Lorna, but not
 * with anyone else"). Objective H.
 *
 *   private    — its author only.
 *   hr         — its author plus the People-access colleagues they picked
 *                (people_review_notes.shared_with_user_ids, migration 0192).
 *                Never the colleague it is about, never anyone else.
 *   colleague  — the colleague it is about (Employee Hub + a notification),
 *                plus everyone who can open their record: the founder and
 *                anyone with People access (never on their own record).
 *
 * Stored additively: visibility stays 'private' | 'shared'; the HR level is
 * a private note with chosen viewers. Anything that reads only `visibility`
 * still treats an HR-shared note as private — it fails closed.
 *
 * Who may read what is decided on the server (lib/db
 * employee-review-visibility.ts). These helpers are the wording, the patch
 * a choice turns into, and the confirm steps' rules — pure and tested.
 */

export const SHARE_LEVELS = ["private", "hr", "colleague"] as const;
export type ShareLevel = (typeof SHARE_LEVELS)[number];

export interface ShareableNote {
  visibility: string;
  sharedWithUserIds?: readonly number[] | null;
}

/** The level a stored note is at. Anything unexpected reads as private. */
export function noteLevel(note: ShareableNote): ShareLevel {
  if (note.visibility === "shared") return "colleague";
  return (note.sharedWithUserIds ?? []).length > 0 ? "hr" : "private";
}

/** "Lorna", "Lorna and Sam", "Lorna, Sam and Pat". */
export function joinNames(names: readonly string[]): string {
  const n = names.map(s => s.trim()).filter(Boolean);
  if (n.length <= 1) return n[0] ?? "";
  return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

export const firstNameOf = (name: string | null | undefined): string =>
  (name ?? "").trim().split(/\s+/)[0] ?? "";

/** The card's label: "Private to you", "Shared with Lorna", "Shared with Major". */
export function levelLabel(level: ShareLevel, o: { colleagueFirst: string; hrNames: readonly string[]; viewerIsAuthor?: boolean }): string {
  if (level === "colleague") return `Shared with ${o.colleagueFirst || "them"}`;
  if (level === "hr") return o.hrNames.length ? `Shared with ${joinNames(o.hrNames)}` : "Shared with HR";
  return o.viewerIsAuthor === false ? "Private" : "Private to you";
}

/** What the server is sent for a chosen level. Sharing with the colleague
 *  keeps the HR list as it was (they already see it — People access). */
export function patchForLevel(level: ShareLevel, hrUserIds: readonly number[]): { visibility: "private" | "shared"; sharedWithUserIds?: number[] } {
  if (level === "colleague") return { visibility: "shared" };
  if (level === "hr") return { visibility: "private", sharedWithUserIds: [...new Set(hrUserIds)] };
  return { visibility: "private", sharedWithUserIds: [] };
}

/**
 * The HR viewers a request may name, checked on the server: only people
 * who may open this record (`allowed` — People access or the founder, never
 * the colleague themselves), never the author (they see it anyway), each
 * once. Returns the clean list, or an error naming nobody.
 */
export function cleanHrViewerIds(
  requested: readonly number[],
  o: { allowed: ReadonlySet<number>; authorId: number; subjectUserId: number },
): { ok: true; ids: number[] } | { ok: false; error: string } {
  const ids = [...new Set(requested)].filter(id => id !== o.authorId);
  if (ids.includes(o.subjectUserId)) return { ok: false, error: "A private HR note can't be shared with the person it's about — use Share with them instead." };
  if (ids.some(id => !o.allowed.has(id))) return { ok: false, error: "You can only share with people who have People access to this record." };
  return { ok: true, ids: ids.sort((a, b) => a - b) };
}

// ── The confirm dialog ─────────────────────────────────────────────────────

export interface ShareDialogState {
  target: ShareLevel;
  /** Sharing with the colleague: 1 = read exactly what goes, 2 = tick + share. */
  step: 1 | 2;
  /** "I've checked this is ready to share" (colleague, step 2). */
  checked: boolean;
  hrUserIds: readonly number[];
}

/** May the final button be pressed? Sharing with the colleague needs both
 *  steps AND the tick; HR needs at least one person picked; going back to
 *  private just needs choosing (its own confirm is the dialog itself). */
export function canConfirmShare(s: ShareDialogState, current: ShareLevel): boolean {
  if (s.target === current && s.target !== "hr") return false;
  if (s.target === "colleague") return s.step === 2 && s.checked;
  if (s.target === "hr") return s.hrUserIds.length > 0;
  return true;
}

/** Does this choice need the two-step confirmation? Only publishing to the
 *  colleague — it reaches them, and can't be unseen. */
export const needsDoubleConfirm = (target: ShareLevel, current: ShareLevel): boolean =>
  target === "colleague" && current !== "colleague";

/** Who will see it, in one plain sentence, for the dialog. */
export function whoWillSee(target: ShareLevel, o: { colleagueFirst: string; hrNames: readonly string[]; othersWithAccess: readonly string[] }): string {
  if (target === "colleague") {
    const also = o.othersWithAccess.length ? ` ${joinNames(o.othersWithAccess)} can read it too (People access).` : "";
    return `${o.colleagueFirst} will see this in their Employee Hub and get a notification in the app.${also}`;
  }
  if (target === "hr") {
    return o.hrNames.length
      ? `Only you and ${joinNames(o.hrNames)} will be able to read it. Not ${o.colleagueFirst}, not anyone else.`
      : "Pick who to share it with.";
  }
  return `Only you will be able to read it.${o.hrNames.length ? ` ${joinNames(o.hrNames)} won't see it any more.` : ""}`;
}

/** The final button's words. */
export function confirmLabel(target: ShareLevel, o: { colleagueFirst: string; hrNames: readonly string[] }): string {
  if (target === "colleague") return `Share with ${o.colleagueFirst}`;
  if (target === "hr") return o.hrNames.length ? `Share with ${joinNames(o.hrNames)}` : "Share";
  return "Make it private to you";
}

/** The audit line for a level change. Never what's in the note, never names. */
export function levelAuditDetail(what: string, from: ShareLevel, to: ShareLevel, hrCount: number): string {
  if (to === "colleague") return `${what} shared with them`;
  if (to === "hr") return `${what} shared with ${hrCount} HR colleague${hrCount === 1 ? "" : "s"}${from === "colleague" ? " (taken back from them)" : ""}`;
  return `${what} made private again`;
}
