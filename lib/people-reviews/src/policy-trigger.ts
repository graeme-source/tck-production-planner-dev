/**
 * Has the attendance policy's review trigger been dealt with? (Graeme,
 * 2026-10-12.)
 *
 * "If the policy calls for a review meeting, I have already booked that
 * meeting. It's asked me to still do it, so it should recognise that I've
 * already booked it and carried it out as well."
 *
 * The policy: N sickness instances or N lates in a rolling 12 months → a
 * review meeting. Reaching the trigger is a fact about attendance; whether
 * anyone still needs to ACT on it depends on the reviews since. One rule,
 * shared by the person record's banner, the People list's "Needs
 * attention" and the server's list ordering:
 *
 *   due        trigger reached, no review since the day it was reached
 *   booked     a review is booked on/after that day and not held yet
 *   handled    a review was held on/after that day, and no new instance
 *              (late / sickness instance) has happened after it
 *   due_again  a review was held, but there have been new instances after
 *              it and they're still at/over the trigger — a follow-up is
 *              needed (unless one is already booked → booked)
 *
 * "The day it was reached" = the date of the instance that took the count
 * in the current rolling window to the threshold (the Nth, oldest first).
 * A review dated on or after that day counts; one before it doesn't.
 *
 * Reviews come from BOTH places they're recorded today: the meetings diary
 * (employee_meetings, kind "review", never a cancelled one) and the
 * employment record (an entry whose classification shows attendance
 * evidence). The server turns rows into PolicyReviewFact with the two
 * helpers below; everything else here is pure.
 */
import { fmtDayIso } from "./index";

export type PolicyTriggerKind = "sickness" | "lates";
export type PolicyTriggerState = "due" | "booked" | "handled" | "due_again";

export interface PolicyReviewRef {
  /** "meeting" = the meetings diary; "entry" = an employment-record entry. */
  source: "meeting" | "entry";
  id: number;
  date: string;
}

export interface PolicyReviewFact extends PolicyReviewRef {
  /** Held (happened) vs booked (still to come). */
  held: boolean;
  /** Which triggers this review deals with. */
  covers: readonly PolicyTriggerKind[];
}

export interface PolicyTriggerStatus {
  kind: PolicyTriggerKind;
  state: PolicyTriggerState;
  count: number;
  threshold: number;
  /** The day the trigger was reached (see the header). */
  reachedOn: string;
  /** The latest review held on/after reachedOn. */
  lastReview: PolicyReviewRef | null;
  /** A review booked and not yet held (state "booked"). */
  booked: PolicyReviewRef | null;
  /** Instances after lastReview (0 when none was held). */
  sinceReview: number;
}

/** Legacy meetings that count: kind "review", never cancelled. */
export const POLICY_REVIEW_MEETING_KINDS: readonly string[] = ["review"];

const ref = (r: PolicyReviewFact): PolicyReviewRef => ({ source: r.source, id: r.id, date: r.date });
const day = (iso: string) => iso.slice(0, 10);

/** The Nth instance, oldest first — the day the count reached N. */
export function triggerReachedOn(instanceDates: readonly string[], threshold: number): string | null {
  if (threshold < 1) return null;
  const sorted = instanceDates.map(day).sort();
  return sorted[threshold - 1] ?? null;
}

/** Where the trigger stands for one kind; null when it isn't reached. */
export function policyTriggerStatus(
  kind: PolicyTriggerKind,
  input: { threshold: number; instanceDates: readonly string[]; reviews: readonly PolicyReviewFact[] },
): PolicyTriggerStatus | null {
  const dates = input.instanceDates.map(day);
  const count = dates.length;
  const reachedOn = triggerReachedOn(dates, input.threshold);
  if (count < input.threshold || reachedOn == null) return null;

  const relevant = input.reviews
    .filter(r => r.covers.includes(kind) && day(r.date) >= reachedOn)
    .map(r => ({ ...r, date: day(r.date) }));
  const held = relevant.filter(r => r.held).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const lastHeld = held[0] ?? null;
  const base = { kind, count, threshold: input.threshold, reachedOn };

  if (lastHeld) {
    const sinceReview = dates.filter(d => d > lastHeld.date).length;
    if (sinceReview === 0) {
      return { ...base, state: "handled", lastReview: ref(lastHeld), booked: null, sinceReview };
    }
    // A follow-up already booked after the review counts as booked.
    const followUp = relevant
      .filter(r => !r.held && r.date >= lastHeld.date && !(r.source === lastHeld.source && r.id === lastHeld.id))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)[0];
    if (followUp) return { ...base, state: "booked", lastReview: ref(lastHeld), booked: ref(followUp), sinceReview };
    return { ...base, state: "due_again", lastReview: ref(lastHeld), booked: null, sinceReview };
  }

  const booked = relevant.filter(r => !r.held).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)[0];
  if (booked) return { ...base, state: "booked", lastReview: null, booked: ref(booked), sinceReview: 0 };
  return { ...base, state: "due", lastReview: null, booked: null, sinceReview: 0 };
}

/** Only these nag: a red flag on the list, "Needs attention", the red banner. */
export function needsPolicyReview(s: Pick<PolicyTriggerStatus, "state"> | null | undefined): boolean {
  return s?.state === "due" || s?.state === "due_again";
}

export interface PolicyTriggerReview {
  sickness: PolicyTriggerStatus | null;
  lates: PolicyTriggerStatus | null;
}

export const NO_POLICY_TRIGGER: PolicyTriggerReview = { sickness: null, lates: null };

// ── Rows → facts (the server's two sources) ────────────────────────────────

/** A meetings-diary row. Cancelled meetings, and kinds that aren't a
 *  review, never count. Its date: scheduled, else held, else created — the
 *  same date the timeline shows it on. */
export function meetingReviewFact(m: {
  id: number; kind: string; status: string;
  scheduledFor: string | null; heldAt: string | null; createdAt: string | null;
}): PolicyReviewFact | null {
  if (m.status === "cancelled" || !POLICY_REVIEW_MEETING_KINDS.includes(m.kind)) return null;
  const date = (m.scheduledFor ?? m.heldAt ?? m.createdAt ?? "").slice(0, 10);
  if (!date) return null;
  return { source: "meeting", id: m.id, date, held: m.status === "held", covers: ["sickness", "lates"] };
}

/** An employment-record entry. Only classifications that show attendance
 *  evidence count: "timekeeping" deals with lates; "attendance" with
 *  sickness and lates. Dated by its meeting, else the entry date; held
 *  once that day has come. */
export function entryReviewFact(e: {
  id: number; evidence: string | null; meetingDate: string | null; entryDate: string;
}, todayIso: string): PolicyReviewFact | null {
  const covers: PolicyTriggerKind[] | null =
    e.evidence === "timekeeping" ? ["lates"]
      : e.evidence === "attendance" ? ["sickness", "lates"]
        : null;
  if (!covers) return null;
  const date = (e.meetingDate ?? e.entryDate).slice(0, 10);
  return { source: "entry", id: e.id, date, held: date <= todayIso, covers };
}

// ── Words ──────────────────────────────────────────────────────────────────

function noun(kind: PolicyTriggerKind, n: number, more = false): string {
  const m = more ? " more" : "";
  if (kind === "lates") return `${n}${m} late${n === 1 ? "" : "s"}`;
  return `${n}${m} sickness instance${n === 1 ? "" : "s"}`;
}

/** The headline for the person record (and anything else that names it). */
export function policyTriggerLine(s: PolicyTriggerStatus, months: number): string {
  switch (s.state) {
    case "due":
      return `Policy trigger reached — ${noun(s.kind, s.count)} in ${months} months. The policy calls for a review meeting.`;
    case "booked":
      return s.lastReview
        ? `${noun(s.kind, s.sinceReview, true)} since the review on ${fmtDayIso(s.lastReview.date)} — follow-up booked for ${fmtDayIso(s.booked?.date)}`
        : `Policy trigger reached (${noun(s.kind, s.count)}) — review booked for ${fmtDayIso(s.booked?.date)}`;
    case "handled":
      return `Policy trigger reached (${noun(s.kind, s.count)}) — reviewed ${fmtDayIso(s.lastReview?.date)}`;
    case "due_again":
      return `${noun(s.kind, s.sinceReview, true)} since the review on ${fmtDayIso(s.lastReview?.date)} — the policy calls for a follow-up`;
  }
}
