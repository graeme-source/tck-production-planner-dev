/**
 * How one person's review record arranges itself on screen.
 *
 * Notes can belong to a meeting (its write-up: what was said, feedback given,
 * objectives set) or stand alone. The rules:
 *   • An objective is SHOWN TWICE, on purpose: nested under the meeting that
 *     set it, so you can see when it was agreed and in what conversation,
 *     AND summarised at the top so the person is reminded of it without
 *     digging back through meetings (Graeme, 2026-09-17). It used to be
 *     lifted to the top and REMOVED from its meeting, which made a probation
 *     meeting look as though no objectives came out of it.
 *   • The top summary carries the CURRENT objectives only — the ones from
 *     the most recent meeting that set any. Each review supersedes the last,
 *     so older open objectives stay in their meeting and out of the summary.
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

/** Meetings, newest first, as the record holds them. */
export interface GroupableMeeting {
  id: number;
  heldAt: string | null;
  scheduledFor: string | null;
  createdAt?: string | null;
}

export interface GroupedRecordNotes<N> {
  /** The CURRENT objectives — open, and from the latest meeting that set any.
   *  Also still present in byMeeting under that meeting. */
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
    // NO `continue` here: an objective belongs to its meeting as well as to
    // the summary. Removing it from the meeting is what made a probation
    // meeting look empty of objectives (Graeme, 2026-09-17).
    if (n.kind === "objective" && !n.doneAt) openObjectives.push(n);
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

/**
 * Narrow open objectives to the CURRENT set — the ones agreed at the most
 * recent meeting that set any.
 *
 * Every pay or probation review restates what the person is working towards,
 * so the summary at the top must show the latest word and not accumulate
 * years of them (Graeme, 2026-09-17). Older objectives are not lost: they
 * stay under their own meeting in the record.
 *
 * Objectives written outside any meeting are standing instructions rather
 * than the outcome of a review, so they are always current.
 */
export function currentObjectives<N extends GroupableNote>(
  openObjectives: readonly N[],
  meetings: readonly GroupableMeeting[],
): N[] {
  const standalone = openObjectives.filter(o => o.meetingId == null);
  const fromMeetings = openObjectives.filter(o => o.meetingId != null);
  if (fromMeetings.length === 0) return [...standalone];

  const when = (m: GroupableMeeting): number => {
    const raw = m.heldAt ?? m.scheduledFor ?? m.createdAt ?? null;
    const t = raw ? Date.parse(raw) : NaN;
    // An undated meeting must not win the comparison by accident; fall back
    // to its id, which still rises over time.
    return Number.isNaN(t) ? -1 : t;
  };
  const rank = new Map(meetings.map(m => [m.id, { time: when(m), id: m.id }]));

  let latestId: number | null = null;
  let latest = { time: -Infinity, id: -Infinity };
  for (const o of fromMeetings) {
    const r = rank.get(o.meetingId as number);
    if (!r) continue;
    if (r.time > latest.time || (r.time === latest.time && r.id > latest.id)) {
      latest = r;
      latestId = o.meetingId as number;
    }
  }
  if (latestId == null) return [...standalone, ...fromMeetings];
  return [...standalone, ...fromMeetings.filter(o => o.meetingId === latestId)];
}
