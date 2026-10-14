/**
 * A loose note on someone's record — a note or observation that isn't part
 * of a meeting (Graeme, 2026-10-14: "I need to be able to just put notes,
 * observations, stuff like that, privately, and choose to publish them if I
 * wish"). Stored as a people_review_notes row with no entry (migration
 * 0178), private to its author until shared. Objective H.
 *
 * A loose note has no date column of its own: the record dates it by when
 * it was written (created_at). So a backdated observation is written with
 * created_at on that day — midday UTC, so it reads as the same calendar day
 * in London whatever the season. The audit log keeps the real time.
 */

export const LOOSE_NOTE_TITLE_MAX = 200;
export const LOOSE_NOTE_BODY_MAX = 10_000;

export type LooseNoteDate =
  | { ok: true; createdAt: Date | null }
  | { ok: false; error: string };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDay(iso: string): boolean {
  if (!ISO_DAY.test(iso)) return false;
  const d = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/**
 * When a loose note should say it was written. No date, or today → null
 * (stamp it now). An earlier day → midday UTC on that day. A day still to
 * come is refused — an observation is something that has happened.
 */
export function looseNoteDate(noteDate: string | null | undefined, today: string): LooseNoteDate {
  if (noteDate == null || noteDate === "" || noteDate === today) return { ok: true, createdAt: null };
  if (!isRealDay(noteDate)) return { ok: false, error: "That isn't a real date." };
  if (noteDate > today) return { ok: false, error: "A note can't be dated in the future — pick today or an earlier day." };
  return { ok: true, createdAt: new Date(`${noteDate}T12:00:00Z`) };
}

/** The line the audit log keeps for a new loose note. Says nothing of what's in it. */
export function looseNoteAuditDetail(shared: boolean, noteDate: string | null | undefined, today: string): string {
  const when = noteDate && noteDate !== today ? `, dated ${noteDate}` : "";
  return `Note added (${shared ? "shared with them" : "private"}${when})`;
}

/** Enough to save: something written in the box. */
export function looseNoteCanSave(body: string): boolean {
  return body.trim().length > 0 && body.length <= LOOSE_NOTE_BODY_MAX;
}
