/**
 * How one person's review record arranges itself on screen.
 *
 * Notes can belong to a meeting (its write-up: what was said, feedback given,
 * objectives set) or stand alone. The rules:
 *   • OPEN objectives always live in "What we agreed" — one actionable list,
 *     wherever they were written.
 *   • Everything else attached to a meeting the record knows about renders
 *     nested under that meeting's card.
 *   • A note pointing at a meeting the record doesn't hold (deleted meeting,
 *     or a stray id) falls back to the flat diary — a note must never vanish
 *     because its meeting did.
 */

export interface GroupableNote {
  id: number;
  kind: string;
  meetingId: number | null;
  doneAt: string | null;
}

export interface GroupedRecordNotes<N> {
  /** Objectives not yet done — the "What we agreed" list. */
  openObjectives: N[];
  /** Diary notes per meeting id, in the order the server sent them. */
  byMeeting: Map<number, N[]>;
  /** Diary notes with no (known) meeting. */
  unattached: N[];
}

export function groupRecordNotes<N extends GroupableNote>(
  notes: readonly N[],
  knownMeetingIds: ReadonlySet<number>,
): GroupedRecordNotes<N> {
  const openObjectives: N[] = [];
  const byMeeting = new Map<number, N[]>();
  const unattached: N[] = [];

  for (const n of notes) {
    if (n.kind === "objective" && !n.doneAt) {
      openObjectives.push(n);
      continue;
    }
    if (n.meetingId != null && knownMeetingIds.has(n.meetingId)) {
      const list = byMeeting.get(n.meetingId) ?? [];
      list.push(n);
      byMeeting.set(n.meetingId, list);
    } else {
      unattached.push(n);
    }
  }

  return { openObjectives, byMeeting, unattached };
}
