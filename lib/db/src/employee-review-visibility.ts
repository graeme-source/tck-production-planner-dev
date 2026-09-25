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
  /** Has People access — the per-person switch in Settings → Team &
   *  Access (people_access_grants, migration 0126), looked up by the server.
   *  Identity, not role, decides who looks after people-data. Missing or
   *  false = no access. */
  hasPeopleAccess?: boolean;
  /** Explicitly switched on for this viewer, for this person's record.
   *  Defaults to false — being an admin does not grant it. */
  hasPrivateGrant?: boolean;
}

/**
 * Who looks after everyone else's record: the people the founder has given
 * People access in Settings → Team & Access (Graeme, 2026-09-25).
 *
 * NOT a role (Graeme, 2026-09-17: "me and Lorna only, strictly"). It was
 * role-based once, which quietly meant every admin and every manager could
 * open anyone's probation meetings and feedback. Promoting somebody to
 * manager must never hand them the personnel files as a side effect.
 *
 * It was a hard-coded email list until 2026-09-25; the server now reads the
 * switch from the database (api-server lib/people-access.ts) and passes it
 * in, so this stays pure. The same switch decides return-to-work access.
 */
export function canManageRecord(viewer: { hasPeopleAccess?: boolean }): boolean {
  return viewer.hasPeopleAccess === true;
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
