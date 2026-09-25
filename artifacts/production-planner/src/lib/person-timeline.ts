/**
 * One person's record as ONE chronological timeline (Graeme, 2026-09-25:
 * "a full, single location where we've got all the information we need").
 *
 * It mixes: absence spells (each carrying its return-to-work form state),
 * lates, return-to-work forms that don't sit on a detected spell (hand-
 * recorded absences, or history older than the window), meetings — reviews,
 * probation meetings, 1:1s — and notes/feedback/objectives written outside
 * a meeting. Notes written as part of a meeting stay nested inside that
 * meeting's card (lib/employee-record-grouping.ts), never loose.
 *
 * Pure, so the merge, the order, the window and the filter chips are tested.
 */

export type SpellFormState = "needed" | "missing" | "away" | "draft" | "signed";

export interface TimelineSpell {
  start: string;
  end: string;
  days: number;
  types: string[];
  sickness: boolean;
  returned: boolean;
  formId: number | null;
  formStatus: string | null;
  formState: SpellFormState;
}

export interface TimelineLate { date: string; label: string }

export interface TimelineFormLike { id: number; absenceStart: string; absenceEnd: string | null }
export interface TimelineMeetingLike { id: number; scheduledFor: string | null; heldAt: string | null; createdAt?: string | null }
export interface TimelineNoteLike { id: number; createdAt: string }

export type TimelineEntry<F extends TimelineFormLike, M extends TimelineMeetingLike, N extends TimelineNoteLike> =
  | { kind: "absence"; key: string; date: string; spell: TimelineSpell; form: F | null }
  | { kind: "late"; key: string; date: string; late: TimelineLate }
  | { kind: "form"; key: string; date: string; form: F }
  | { kind: "meeting"; key: string; date: string; meeting: M }
  | { kind: "note"; key: string; date: string; note: N };

export type TimelineFilter = "all" | "attendance" | "rtw" | "meetings" | "notes";

export const TIMELINE_FILTERS: Array<{ key: TimelineFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "attendance", label: "Attendance" },
  { key: "rtw", label: "Return to work" },
  { key: "meetings", label: "Meetings & reviews" },
  { key: "notes", label: "Notes" },
];

/** The day a meeting sits on: when it's booked for, else when it was held. */
export function meetingDate(m: TimelineMeetingLike): string {
  return (m.scheduledFor ?? m.heldAt ?? m.createdAt ?? "").slice(0, 10);
}

// Same-day order, newest-first list: the conversation, then what was
// written, then the paperwork, then the attendance facts.
const KIND_RANK: Record<string, number> = { meeting: 0, note: 1, form: 2, absence: 3, late: 4 };

export function buildPersonTimeline<F extends TimelineFormLike, M extends TimelineMeetingLike, N extends TimelineNoteLike>(input: {
  spells: readonly TimelineSpell[];
  lates: readonly TimelineLate[];
  forms: readonly F[];
  meetings: readonly M[];
  /** Notes NOT attached to a meeting the record holds. */
  looseNotes: readonly N[];
}): Array<TimelineEntry<F, M, N>> {
  const formsById = new Map(input.forms.map(f => [f.id, f]));
  const onSpell = new Set(input.spells.map(s => s.formId).filter((id): id is number => id != null));
  const out: Array<TimelineEntry<F, M, N>> = [
    ...input.spells.map(spell => ({
      kind: "absence" as const, key: `a-${spell.start}`, date: spell.end, spell,
      form: spell.formId != null ? formsById.get(spell.formId) ?? null : null,
    })),
    ...input.lates.map((late, i) => ({ kind: "late" as const, key: `l-${late.date}-${i}`, date: late.date, late })),
    ...input.forms.filter(f => !onSpell.has(f.id))
      .map(form => ({ kind: "form" as const, key: `f-${form.id}`, date: form.absenceEnd ?? form.absenceStart, form })),
    ...input.meetings.map(meeting => ({ kind: "meeting" as const, key: `m-${meeting.id}`, date: meetingDate(meeting), meeting })),
    ...input.looseNotes.map(note => ({ kind: "note" as const, key: `n-${note.id}`, date: note.createdAt.slice(0, 10), note })),
  ];
  return out.sort((a, b) =>
    b.date.localeCompare(a.date)
    || KIND_RANK[a.kind] - KIND_RANK[b.kind]
    || b.key.localeCompare(a.key));
}

export function entryMatchesFilter(e: { kind: string }, filter: TimelineFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "attendance": return e.kind === "absence" || e.kind === "late";
    case "rtw": return e.kind === "absence" || e.kind === "form";
    case "meetings": return e.kind === "meeting";
    case "notes": return e.kind === "note";
  }
}

export function filterTimeline<E extends { kind: string }>(entries: readonly E[], filter: TimelineFilter): E[] {
  return entries.filter(e => entryMatchesFilter(e, filter));
}

export function timelineCounts(entries: ReadonlyArray<{ kind: string }>): Record<TimelineFilter, number> {
  const counts = { all: 0, attendance: 0, rtw: 0, meetings: 0, notes: 0 } as Record<TimelineFilter, number>;
  for (const e of entries) {
    for (const f of TIMELINE_FILTERS) if (entryMatchesFilter(e, f.key)) counts[f.key] += 1;
  }
  return counts;
}

/** Keep what falls on or after `fromIso`. Anything dated in the future — a
 *  booked meeting — always stays, and an undated entry is never lost. */
export function withinWindow<E extends { date: string }>(entries: readonly E[], fromIso: string): E[] {
  return entries.filter(e => !e.date || e.date >= fromIso);
}

/** Absence spells that can still get a form started from the record. */
export function spellsWithoutForm(spells: readonly TimelineSpell[]): TimelineSpell[] {
  return spells.filter(s => s.formId == null);
}

/** "3 years 6 months", "5 months", "2 weeks", "Starts 6 Oct 2026". */
export function lengthOfService(startIso: string | null | undefined, todayIso: string): string | null {
  if (!startIso) return null;
  const start = startIso.slice(0, 10);
  if (start > todayIso) {
    const d = new Date(`${start}T00:00:00Z`);
    return `Starts ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
  }
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ty, tm, td] = todayIso.split("-").map(Number);
  let months = (ty - sy) * 12 + (tm - sm);
  if (td < sd) months -= 1;
  if (months < 1) {
    const days = Math.round((Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
    const weeks = Math.floor(days / 7);
    return weeks >= 1 ? `${weeks} week${weeks === 1 ? "" : "s"}` : `${days} day${days === 1 ? "" : "s"}`;
  }
  const years = Math.floor(months / 12);
  const rem = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  if (rem > 0) parts.push(`${rem} month${rem === 1 ? "" : "s"}`);
  return parts.join(" ");
}
