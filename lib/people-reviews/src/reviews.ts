/**
 * One review, classified (Graeme, 2026-10-12): "I just want a review, and it
 * can be for disciplinary reasons or for performance. I want it to be a
 * classification so I can go back and change them."
 *
 * A REVIEW is a record entry with a meeting status — booked, held or
 * cancelled (NULL = nothing to meet about, just on the record). Its
 * classification is the entry's classification, changeable at any time; the
 * ACAS meeting type (informal chat, investigation, disciplinary hearing,
 * appeal) is an optional detail on it, never a second kind picked up front.
 *
 * Its WRITE-UP is a set of review notes — feedback, objectives, notes — each
 * private to whoever wrote it until shared with the employee (who may read
 * which is decided on the server by @workspace/db's
 * employee-review-visibility). Migration 0178 moved the old meetings + notes
 * in here.
 *
 * Pure: shared by routes/people-reviews*.ts and components/people/*.
 */

export const MEETING_STATUSES = ["booked", "held", "cancelled"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];
export const MEETING_STATUS_LABEL: Record<MeetingStatus, string> = {
  booked: "Booked",
  held: "Held",
  cancelled: "Cancelled",
};

export const NOTE_KINDS = ["note", "feedback", "objective"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  note: "Note",
  feedback: "Feedback",
  objective: "Objective",
};

export interface ReviewLike {
  entryDate: string;
  meetingDate: string | null;
  meetingStatus: MeetingStatus | null;
}

/** Is this entry a review (it has, or had, a meeting)? */
export function isReview(e: Pick<ReviewLike, "meetingStatus">): boolean {
  return e.meetingStatus != null;
}

/** The day a review sits on: its meeting day, else the entry's date. */
export function reviewDay(e: Pick<ReviewLike, "entryDate" | "meetingDate">): string {
  return e.meetingDate ?? e.entryDate;
}

/** What a newly booked review starts as. "Already held" wins; otherwise a
 *  day already gone is held and today or later is booked. */
export function startingMeetingStatus(date: string | null, todayIso: string, alreadyHeld = false): MeetingStatus {
  if (alreadyHeld) return "held";
  return date != null && date < todayIso ? "held" : "booked";
}

/** The day the booker's meeting to-do should sit on — none once cancelled. */
export function meetingTodoDate(status: MeetingStatus | null, meetingDate: string | null): string | null {
  return status === "cancelled" ? null : meetingDate;
}

/** What changing a review's status does to held_at, and the history line. */
export function meetingStatusChange(from: MeetingStatus | null, to: MeetingStatus | null, heldAt: Date | string | null):
  { stampHeldAt: boolean; message: string } {
  const label = (s: MeetingStatus | null) => (s ? MEETING_STATUS_LABEL[s].toLowerCase() : "no meeting");
  return {
    // Stamp the first time it's marked held; changing away keeps the stamp
    // (it did happen, or the history says when it was said to).
    stampHeldAt: to === "held" && heldAt == null,
    message: from == null ? `Meeting ${label(to)}` : `Meeting changed from ${label(from)} to ${label(to)}`,
  };
}

// ── The write-up ───────────────────────────────────────────────────────────

export interface WriteUpInput {
  feedback?: string | null;
  objectives?: ReadonlyArray<{ title?: string | null; body?: string | null; dueDate?: string | null }> | null;
  notes?: string | null;
}

export interface WriteUpRow {
  kind: NoteKind;
  title: string | null;
  body: string;
  dueDate: string | null;
}

/** The rows a write-up saves, in the order the conversation runs: how it
 *  went, what was agreed, then anything else. Blank parts are dropped; an
 *  objective with only a title keeps it as its body so a headline never
 *  sits over nothing. Empty array = nothing to save. */
export function writeUpRows(w: WriteUpInput): WriteUpRow[] {
  const rows: WriteUpRow[] = [];
  const feedback = (w.feedback ?? "").trim();
  if (feedback) rows.push({ kind: "feedback", title: null, body: feedback, dueDate: null });
  for (const o of w.objectives ?? []) {
    const title = (o.title ?? "").trim();
    const body = (o.body ?? "").trim();
    if (!title && !body) continue;
    rows.push(body
      ? { kind: "objective", title: title || null, body, dueDate: o.dueDate ?? null }
      : { kind: "objective", title: null, body: title, dueDate: o.dueDate ?? null });
  }
  const notes = (w.notes ?? "").trim();
  if (notes) rows.push({ kind: "note", title: null, body: notes, dueDate: null });
  return rows;
}

/** Has a meeting been written up? Cancelled needs nothing; otherwise an
 *  outcome, a write-up note, or (for an entry with no meeting status) being
 *  closed counts. A booked or held review with nothing written isn't. */
export function meetingWrittenUp(e: {
  meetingStatus: MeetingStatus | null; outcome: string | null; status: string; writeUpCount: number;
  /** The entry's own notes box. Notes typed there ARE the write-up (Graeme,
   *  2026-10-12: "I don't want to then be asked to add more notes"). */
  notes?: string | null;
}): boolean {
  if (e.meetingStatus === "cancelled") return true;
  if ((e.outcome ?? "").trim() || e.writeUpCount > 0 || (e.notes ?? "").trim()) return true;
  return e.meetingStatus == null && e.status === "closed";
}

// ── "What happened" — ONE write-up per meeting ─────────────────────────────
//
// Graeme, 2026-10-12: "It looks like we've got two different UIs for adding
// information to the same meeting." The entry's notes box (typed at booking
// or after) and the write-up parts (summary, what was agreed, actions) are
// one thing on screen: the notes first, then the parts, nothing dropped.

export interface WhatHappened<N> {
  /** The entry's own notes (People access only, never shared), or null. */
  recordNotes: string | null;
  /** The write-up parts, in the order they were written. */
  parts: N[];
  hasContent: boolean;
}

export function whatHappened<N>(e: { notes: string | null; writeUp: readonly N[] }): WhatHappened<N> {
  const recordNotes = (e.notes ?? "").trim() ? e.notes : null;
  return { recordNotes, parts: [...e.writeUp], hasContent: recordNotes != null || e.writeUp.length > 0 };
}

/** Notes typed on a BOOKED review once its day has come mean it happened —
 *  mark it held. Notes typed ahead of the day (agenda, prep) don't. */
export function heldByNotes(e: { meetingStatus: MeetingStatus | null; meetingDate: string | null; entryDate: string },
  notes: string | null | undefined, todayIso: string): boolean {
  return e.meetingStatus === "booked" && !!(notes ?? "").trim() && reviewDay(e) <= todayIso;
}

/** Everything already written on a meeting as plain text — what "Use what's
 *  already here" hands the AI, so nothing typed earlier is asked for again. */
export function whatHappenedText(e: {
  notes: string | null;
  writeUp: ReadonlyArray<{ kind: string; title: string | null; body: string }>;
}): string {
  const out: string[] = [];
  const notes = (e.notes ?? "").trim();
  if (notes) out.push(notes);
  for (const n of e.writeUp) {
    const label = NOTE_KIND_LABEL[(NOTE_KINDS as readonly string[]).includes(n.kind) ? n.kind as NoteKind : "note"];
    out.push(`${label}: ${n.title ? `${n.title}\n` : ""}${n.body.trim()}`);
  }
  return out.join("\n\n");
}

/** The classification a meeting scheduled without picking one starts as:
 *  the active one flagged for meetings (data, migration 0182), else the
 *  first active one in the list's order. */
export function defaultMeetingClassification<C extends { id: number; sortOrder: number; label: string; active: boolean; defaultForMeetings?: boolean }>(
  list: readonly C[],
): C | null {
  const active = list.filter(c => c.active);
  return active.find(c => c.defaultForMeetings)
    ?? [...active].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))[0]
    ?? null;
}

// ── Meeting notes drafted by AI ────────────────────────────────────────────

export const ACTION_OWNERS = ["me", "colleague", "other"] as const;
export type ActionOwner = (typeof ACTION_OWNERS)[number];

/** What "Add meeting notes (AI)" drafts and Graeme checks before saving. */
export interface MeetingNotesDraft {
  /** e.g. "Maternity review meeting". */
  title: string;
  /** Short and factual. */
  summary: string;
  /** What was agreed — dates, hours, amounts kept in the words. */
  agreements: Array<{ what: string; detail: string | null; date: string | null }>;
  /** Follow-ups: me = whoever is recording it, colleague = the person whose
   *  record it is, other = someone else (ownerName says who). */
  actions: Array<{ what: string; owner: ActionOwner; ownerName: string | null; date: string | null }>;
  /** A suggestion from the classification list, or null. */
  classificationId: number | null;
}

export const SUMMARY_TITLE = "Summary";
export const ACTIONS_TITLE = "Follow-up actions";

/** The write-up rows a checked draft saves: the summary, each agreement as
 *  an objective (so it lands in "What we agreed"), then the actions as one
 *  note. Blank parts are dropped. Names belong to the record — they never
 *  go near a to-do (see actionTodos). */
export function meetingNotesRows(d: Pick<MeetingNotesDraft, "summary" | "agreements" | "actions">, who: {
  me: string; colleague: string;
}): WriteUpRow[] {
  const rows: WriteUpRow[] = [];
  const summary = d.summary.trim();
  if (summary) rows.push({ kind: "note", title: SUMMARY_TITLE, body: summary, dueDate: null });
  for (const a of d.agreements) {
    const what = a.what.trim();
    const detail = (a.detail ?? "").trim();
    if (!what && !detail) continue;
    rows.push(what && detail
      ? { kind: "objective", title: what, body: detail, dueDate: a.date ?? null }
      : { kind: "objective", title: null, body: what || detail, dueDate: a.date ?? null });
  }
  const lines = d.actions
    .filter(a => a.what.trim())
    .map(a => {
      const owner = a.owner === "me" ? who.me : a.owner === "colleague" ? who.colleague : (a.ownerName ?? "").trim() || "Someone";
      return `• ${a.what.trim()} — ${owner}${a.date ? ` (by ${fmtDayShort(a.date)})` : ""}`;
    });
  if (lines.length) rows.push({ kind: "note", title: ACTIONS_TITLE, body: lines.join("\n"), dueDate: null });
  return rows;
}

/** The booker's own actions become discreet to-dos (generic title, no names
 *  — recordTodo kind "action"); one with no date sits a week out. */
export function actionTodos(actions: MeetingNotesDraft["actions"], todayIso: string): Array<{ date: string }> {
  return actions
    .filter(a => a.owner === "me" && a.what.trim())
    .map(a => ({ date: a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : addDaysIso(todayIso, 7) }));
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDayShort(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// ── The employee's own view ────────────────────────────────────────────────

export interface OwnNoteLike {
  id: number;
  entryId: number | null;
  kind: string;
  doneAt: string | null;
  createdAt: string;
}

export interface OwnReviewLike extends ReviewLike {
  id: number;
  heldAt: string | null;
}

export interface OwnRecordReview<N> {
  entryId: number;
  date: string;
  status: MeetingStatus | null;
  notes: N[];
}

/**
 * The employee's own record, from notes the server has ALREADY filtered to
 * what they may read (shared only, unless they wrote it). Only reviews with
 * something they can read show — the review itself (its classification,
 * summary, stage) is never theirs to see; they get the day and the write-up.
 * "What we agreed" = open objectives from the most recent review that set
 * any, plus any loose ones.
 */
export function ownRecordView<N extends OwnNoteLike>(reviews: readonly OwnReviewLike[], notes: readonly N[]): {
  reviews: Array<OwnRecordReview<N>>;
  loose: N[];
  agreed: N[];
} {
  const byEntry = new Map<number, N[]>();
  const loose: N[] = [];
  const known = new Set(reviews.map(r => r.id));
  for (const n of notes) {
    if (n.entryId != null && known.has(n.entryId)) byEntry.set(n.entryId, [...(byEntry.get(n.entryId) ?? []), n]);
    else loose.push(n);
  }
  const out = reviews
    .filter(r => (byEntry.get(r.id)?.length ?? 0) > 0)
    .map(r => ({ entryId: r.id, date: reviewDay(r), status: r.meetingStatus, notes: byEntry.get(r.id)! }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.entryId - a.entryId);
  const open = (n: N) => n.kind === "objective" && !n.doneAt;
  const latest = out.find(r => r.notes.some(open));
  return {
    reviews: out,
    loose: [...loose].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    agreed: [...loose.filter(open), ...(latest ? latest.notes.filter(open) : [])],
  };
}
