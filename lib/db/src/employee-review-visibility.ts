/**
 * Who is allowed to see what in an employee's review record.
 *
 * This is the most sensitive rule in the feature and the one that must never
 * be got wrong, so it lives on its own, is tested, and is applied on the
 * SERVER before anything is sent — never by hiding rows in the UI.
 *
 * Graeme's rule (2026-09-03): a private note is his alone. Not other managers,
 * not other admins. Later we may grant a named person sight of the private
 * side of a record, but only by explicitly switching it on for them — that is
 * what `hasPrivateGrant` carries, and it is false in the normal case.
 *
 * The employee reads their own record and never writes to it: it is a record
 * of what was said, not a conversation.
 */

export type NoteVisibility = "private" | "shared";

export interface ReviewNoteForVisibility {
  /** Who wrote it. Null only if the author's account was deleted. */
  authorId: number | null;
  /** Typed as string because it arrives from a text column. Anything that
   *  isn't exactly "shared" is treated as private — an unexpected value must
   *  fail CLOSED, never publish a note nobody chose to publish. */
  visibility: string;
}

export interface ReviewViewer {
  id: number;
  role: string;
  /** The account's email. Identity, not role, decides who looks after
   *  people-data — see PEOPLE_DATA_EMAILS. */
  email?: string | null;
  /** Explicitly switched on for this viewer, for this person's record.
   *  Defaults to false — being an admin does not grant it. */
  hasPrivateGrant?: boolean;
}

/**
 * The only people who look after everyone else's record.
 *
 * Named accounts, NOT a role (Graeme, 2026-09-17: "me and Lorna only,
 * strictly"). It was role-based, which quietly meant five people — every
 * admin and every manager, so Jane Miles and Dave Bewsey could open anyone's
 * probation meetings and feedback. Promoting somebody to manager must never
 * hand them the personnel files as a side effect.
 *
 * Same list as the return-to-work managers, and deliberately so: it is one
 * question — who looks after people-data — and it should have one answer.
 * rtw-access.ts imports this rather than keeping a second copy.
 */
export const PEOPLE_DATA_EMAILS: ReadonlySet<string> = new Set([
  "graeme@thecalzonekitchen.co.uk",
  "lornabrown17@icloud.com",
  // Local test account — no such user exists on live.
  "claude-test@thecalzonekitchen.co.uk",
]);

/** Who can book meetings and write notes about someone else. */
export function canManageRecord(viewer: { email?: string | null }): boolean {
  const email = viewer.email?.trim().toLowerCase();
  return email != null && email !== "" && PEOPLE_DATA_EMAILS.has(email);
}

/** Can this viewer open this person's record at all? */
export function canOpenRecord(viewer: ReviewViewer, subjectUserId: number): boolean {
  return viewer.id === subjectUserId || canManageRecord(viewer);
}

/** Can this viewer read this note?
 *
 *  Private — the author, plus anyone explicitly granted. A manager or admin
 *  who did not write it does NOT qualify: "private" would mean nothing if the
 *  next admin could read it.
 *  Shared  — the person it is about, and whoever looks after their record.
 */
export function canReadNote(
  note: ReviewNoteForVisibility,
  viewer: ReviewViewer,
  subjectUserId: number,
): boolean {
  if (note.visibility !== "shared") {
    if (note.authorId != null && note.authorId === viewer.id) return true;
    return viewer.hasPrivateGrant === true;
  }
  if (viewer.id === subjectUserId) return true;
  return canManageRecord(viewer);
}

/** Filter notes down to what this viewer may see. The server sends the OUTPUT
 *  of this, never the input. */
export function visibleNotes<T extends ReviewNoteForVisibility>(
  notes: readonly T[],
  viewer: ReviewViewer,
  subjectUserId: number,
): T[] {
  return notes.filter(n => canReadNote(n, viewer, subjectUserId));
}
