/**
 * Plain-English read-out of one meat's self-correcting oven time (Graeme,
 * 28 Oct 2026: "give me information that is just clear about what has
 * happened and what needs to happen, and what changes you're proposing").
 *
 * The maths stays in @workspace/production-schedule (meat-timing-learning.ts);
 * this only turns its numbers into three sentences a manager can act on:
 *   - NOW: when it goes in the oven today;
 *   - WHAT HAPPENED: how long the mix really took after the oven, and how the
 *     recent days went (sat waiting / builders waited);
 *   - CHANGE: the new put-in time and why, or that nothing needs changing.
 * The breakdown (cook + oven-to-mix + spare) is kept for a "how it's worked
 * out" fold, never shown by default. Pure. Objectives D, F.
 */
import type { MeatLearning } from "@workspace/production-schedule";

export interface MeatTimingInput {
  cookMinutes: number | null;
  processMinutes: number | null;
  bufferMinutes: number | null;
  configuredLeadMinutes: number | null;
  autoLearn: boolean;
  learning: Pick<MeatLearning, "status" | "runsUsed" | "processing" | "proposed" | "changes">;
  review: { reviewed: number; perfect: number; waited: number; tooEarly: number; avgSat: number | null; avgWait: number | null } | null;
}

export type MeatTimingProposal =
  | { kind: "change"; headline: string; why: string; when: string }
  | { kind: "none"; headline: string }
  | { kind: "waiting"; headline: string }
  | { kind: "no_cook_time"; headline: string };

export interface MeatTimingSummary {
  /** "Goes in the oven 43 min before the builders need it." Null = no cook time. */
  now: string | null;
  /** What the floor has actually done — null until there's anything recorded. */
  happened: string[];
  proposal: MeatTimingProposal;
  /** For the fold: the three parts of the put-in time, in words. */
  breakdown: string | null;
}

/** Clean days needed before a suggestion (LEARNING_RULES.minRuns). */
const MIN_DAYS = 3;
/** The spare time the schedule uses while none has been learned (LEARNING_RULES.bufferStart). */
const DEFAULT_SPARE = 5;

const mins = (n: number) => `${n} min`;
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

export function meatTimingSummary(m: MeatTimingInput, learningEnabled: boolean): MeatTimingSummary {
  const l = m.learning;
  const lead = m.configuredLeadMinutes;
  const now = m.cookMinutes != null && lead != null
    ? `Goes in the oven ${mins(lead)} before the builders need it.`
    : null;
  const spare = m.bufferMinutes ?? DEFAULT_SPARE;
  const breakdown = m.cookMinutes != null
    ? `${mins(m.cookMinutes)} cooking, then ${m.processMinutes != null ? mins(m.processMinutes) : "no time yet"} to cool, pull, dice and mix, plus ${mins(spare)} spare in case it runs slow or the builders are early.`
    : null;

  const happened: string[] = [];
  if (l.status === "learned" && l.processing) {
    const typical = Math.round(l.processing.median);
    const slow = Math.round(l.processing.slow);
    happened.push(
      `Over the last ${days(l.runsUsed)}, the first tin was mixed about ${mins(typical)} after the meat came out of the oven` +
      (slow > typical ? ` (${mins(slow)} on a slow day).` : "."),
    );
  }
  const r = m.review;
  if (r && r.reviewed > 0) {
    const parts: string[] = [];
    if (r.perfect > 0) parts.push(`right on ${days(r.perfect)}`);
    if (r.waited > 0) parts.push(`the builders waited on ${days(r.waited)}${r.avgWait ? ` (about ${mins(r.avgWait)})` : ""}`);
    if (r.tooEarly > 0) parts.push(`ready too early on ${days(r.tooEarly)}`);
    const sat = r.avgSat != null ? ` On average the meat sat ready for ${mins(r.avgSat)} before it was needed.` : "";
    happened.push(`Checked ${days(r.reviewed)}: ${parts.join(", ") || "no clear result yet"}.${sat}`);
  }

  if (l.status === "no_cook_time") {
    return { now, happened, breakdown, proposal: { kind: "no_cook_time", headline: "No cook time is set for this meat, so it can't be timed. Set one on the ingredient." } };
  }
  if (l.status !== "learned" || !l.proposed) {
    const more = Math.max(1, MIN_DAYS - l.runsUsed);
    return {
      now, happened, breakdown,
      proposal: { kind: "waiting", headline: `No suggestion yet — needs ${more} more recorded ${more === 1 ? "day" : "days"} of it coming out of the oven and being mixed.` },
    };
  }
  if (l.changes.length === 0 || m.cookMinutes == null || lead == null) {
    return { now, happened, breakdown, proposal: { kind: "none", headline: "No change needed — the time is about right." } };
  }

  const newLead = m.cookMinutes + l.proposed.processMinutes + l.proposed.bufferMinutes;
  const diff = newLead - lead;
  const headline = diff === 0
    ? `Keep putting it in ${mins(lead)} before — the split behind it changes slightly.`
    : `Put it in ${mins(newLead)} before the builders need it — ${mins(Math.abs(diff))} ${diff > 0 ? "earlier" : "later"} than now.`;

  const reasons: string[] = [];
  for (const c of l.changes) {
    if (c.from == null) continue;
    if (c.field === "process") {
      reasons.push(c.to > c.from ? "the mix has been taking longer after the oven than we allow" : "the mix has been ready quicker after the oven than we allow");
    } else {
      reasons.push(c.to > c.from ? "more spare time stops the builders waiting" : "the meat has been sitting ready longer than it needs to");
    }
  }
  const why = reasons.length > 0
    ? `Why: ${reasons.join(", and ")}.`
    : "Why: this is the first time worked out from what really happened.";
  const when = !learningEnabled
    ? "Not applied — daily automatic learning is switched off."
    : !m.autoLearn
      ? "Not applied — automatic learning is off for this meat."
      : "Changes automatically after today's production. It moves in small steps, so it may move again.";
  return { now, happened, breakdown, proposal: { kind: "change", headline, why, when } };
}

/** Plain words for a change in the history list. */
export function adjustmentFieldLabel(field: "process" | "buffer"): string {
  return field === "process" ? "time from oven to mix" : "spare time";
}
