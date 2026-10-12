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
 * Reviews come from the one place they're recorded since migration 0178
 * (one review, classified): the employment record. WHICH reviews answer a
 * trigger (Graeme, 2026-10-12, after a maternity planning 1:1 was taken as
 * the sickness review: "we need a way to choose what we're going to attach
 * it to") is the entry's answers_trigger (migration 0183):
 *
 *   'sickness' | 'lates' | 'both'  answers that trigger, whatever it's about
 *   'none'                         never answers a trigger
 *   NULL (automatic)               only if its CLASSIFICATION shows
 *                                  attendance evidence (data, never a
 *                                  name): "timekeeping" → lates,
 *                                  "attendance" → sickness and lates. A 1:1,
 *                                  appraisal or any other review doesn't.
 *
 * Cancelled never counts. Booking from the trigger banner sets the link
 * explicitly, so that review always counts. The server turns rows into
 * PolicyReviewFact with entryReviewFact; everything else here is pure.
 */
import { fmtDayIso, combinedEvidence } from "./index";

/** One classification's evidence, or every ticked one's (migration 0184). */
type Evidence = string | null | ReadonlyArray<string | null>;

export type PolicyTriggerKind = "sickness" | "lates";

/** An entry's explicit link to the triggers (migration 0183). NULL on the
 *  entry = automatic (by its classification's attendance evidence). */
export const ANSWERS_TRIGGER = ["none", "sickness", "lates", "both"] as const;
export type AnswersTrigger = (typeof ANSWERS_TRIGGER)[number];

export const ANSWERS_TRIGGER_LABEL: Record<AnswersTrigger, string> = {
  none: "No",
  sickness: "Sickness",
  lates: "Lates",
  both: "Both",
};

/** The question on a review, wherever it's asked. */
export const ANSWERS_TRIGGER_QUESTION = "Does this review deal with the attendance trigger?";

/** The history line when the link changes. */
export function answersTriggerMessage(v: AnswersTrigger | null): string {
  switch (v) {
    case null: return "Attendance trigger: automatic (from what it's about)";
    case "none": return "Attendance trigger: doesn't deal with it";
    case "both": return "Attendance trigger: deals with sickness and lates";
    default: return `Attendance trigger: deals with ${v}`;
  }
}
export type PolicyTriggerState = "due" | "booked" | "handled" | "due_again";

export interface PolicyReviewRef {
  /** Always an employment-record entry since migration 0178. */
  source: "entry";
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

// ── Rows → facts ───────────────────────────────────────────────────────────

/** Which triggers an entry answers. The explicit link wins; NULL =
 *  automatic, by the classification's attendance evidence (data on the
 *  classification, never its name) — "timekeeping" deals with lates,
 *  "attendance" with sickness and lates, anything else with neither. */
// `evidence` may be the evidence of EVERY classification ticked on the entry
// (0184): it answers automatically if ANY of them is attendance / timekeeping.
export function triggersAnswered(answersTrigger: string | null | undefined, evidence: Evidence): PolicyTriggerKind[] {
  switch (answersTrigger) {
    case "none": return [];
    case "sickness": return ["sickness"];
    case "lates": return ["lates"];
    case "both": return ["sickness", "lates"];
  }
  const ev = combinedEvidence(typeof evidence === "string" || evidence == null ? [evidence] : evidence);
  if (ev === "timekeeping") return ["lates"];
  if (ev === "attendance") return ["sickness", "lates"];
  return [];
}

/** An employment-record entry, as a review that can answer a trigger (see
 *  triggersAnswered for which). Cancelled never counts. Dated by its
 *  meeting, else the entry date; held once it's marked held or that day
 *  has come. */
export function entryReviewFact(e: {
  id: number; meetingStatus: string | null; evidence: Evidence; meetingDate: string | null; entryDate: string;
  answersTrigger: string | null;
}, todayIso: string): PolicyReviewFact | null {
  if (e.meetingStatus === "cancelled") return null;
  const covers = triggersAnswered(e.answersTrigger, e.evidence);
  if (covers.length === 0) return null;
  const date = (e.meetingDate ?? e.entryDate).slice(0, 10);
  return { source: "entry", id: e.id, date, held: e.meetingStatus === "held" || date <= todayIso, covers };
}

/** The link a review booked from a trigger banner starts with: that
 *  trigger — or both, when the other one also still needs a review, so one
 *  meeting answers both. */
export function bookingLinkFor(kind: PolicyTriggerKind, review: PolicyTriggerReview | null | undefined): AnswersTrigger {
  const other = kind === "sickness" ? review?.lates : review?.sickness;
  return needsPolicyReview(other) ? "both" : kind;
}

/** Ask "does this review deal with the attendance trigger?" only when a
 *  trigger has been reached in the window (due, booked, handled or due
 *  again), or the entry already has a link set. */
export function showTriggerChoice(review: PolicyTriggerReview | null | undefined, answersTrigger: string | null | undefined): boolean {
  return answersTrigger != null || review?.sickness != null || review?.lates != null;
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
