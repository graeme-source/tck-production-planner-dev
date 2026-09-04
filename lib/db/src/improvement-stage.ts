/**
 * The life of an improvement — shared by the API and the team's screen so
 * both agree on what a state means, what it's called in plain English, and
 * what may happen next (Objective E, migration 0059).
 *
 * Four states the team ever sees:
 *   to do              — logged; nobody has done it yet
 *   waiting            — someone has done it and a manager needs to check
 *   approved           — checked; this is the one that counts for a person
 *   sent back          — a manager wants another look, with a note
 *
 * The rule that makes the Centre mean something (Graeme, 2026-08-26: "an
 * improvement ONLY counts with a photo or a video"): an improvement cannot
 * reach `waiting` without media attached, so it can never reach `approved`
 * without it either. Enforced server-side in routes/improvements.ts, and
 * the reason `canMarkDone` takes an attachment count rather than trusting
 * the screen to have checked.
 *
 * Lives in lib/db (not the api-server) because the frontend needs the same
 * labels and rules, and duplicating them is how the two drift apart.
 */

export type ImprovementStage = "todo" | "waiting" | "approved" | "sent_back";

/** Stored progress_status values that are still written by the app. */
export type ImprovementStatus =
  | "submitted_for_review"
  | "awaiting_approval"
  | "complete"
  | "rejected"
  // Dead values from the July 2026 collapse — read-only, never written.
  | "acknowledged"
  | "approved"
  | "in_development"
  | "testing";

/** Map a stored status to the stage the team understands. Legacy values all
 *  read as "to do": they were logged and never finished. */
export function stageOf(status: string): ImprovementStage {
  switch (status) {
    case "complete": return "approved";
    case "awaiting_approval": return "waiting";
    case "rejected": return "sent_back";
    default: return "todo";
  }
}

export const STAGE_LABEL: Record<ImprovementStage, string> = {
  todo: "To do",
  waiting: "Waiting for approval",
  approved: "Approved",
  sent_back: "Needs another look",
};

/**
 * Can this improvement be marked as done by the team?
 *
 * Needs media — that's the whole point. An improvement that's already
 * waiting or approved can't be marked done again.
 */
export function canMarkDone(status: string, attachmentCount: number): boolean {
  const stage = stageOf(status);
  if (stage === "waiting" || stage === "approved") return false;
  return attachmentCount > 0;
}

/** The reason `canMarkDone` said no, in words the team can act on. */
export function markDoneBlocker(status: string, attachmentCount: number): string | null {
  const stage = stageOf(status);
  if (stage === "waiting") return "This is already waiting for a manager to check it.";
  if (stage === "approved") return "This one's already approved.";
  if (attachmentCount === 0) return "Add a photo or a video first — that's what makes it count.";
  return null;
}

/**
 * Is this photo/video the FINISHED state of the job?
 *
 * An "after" shot is the fix. A "before" shot is the problem — logging an
 * idea starts with one, and the work may be days away. Media with no phase
 * predates the before/after split (migration 0060) and was always uploaded
 * as evidence of something done, so it counts.
 */
export function isCompletionMedia(phase: string | null | undefined): boolean {
  return phase === "after" || phase == null;
}

/**
 * Does attaching this media finish the job on its own?
 *
 * A title and one photo IS the submission (Graeme, 2026-09-04). People were
 * adding the after photo and walking away — not realising a separate "send
 * for approval" tap was still needed. Lorna believed her ice shelf was done
 * while it sat in "to do" for a day.
 *
 * Two things it deliberately does NOT do:
 *  - a "before" photo never submits: logging an idea starts with one, and
 *    auto-submitting would empty the To-do board into the approval queue;
 *  - a sent-back improvement still goes when the person says it's ready —
 *    the manager's note may ask for more than another photo.
 */
export function shouldAutoSubmit(
  status: string,
  phase: string | null | undefined,
  attachmentCount: number,
): boolean {
  return stageOf(status) === "todo" && attachmentCount > 0 && isCompletionMedia(phase);
}

/** Only a manager, and only on something actually waiting. */
export function canReview(status: string): boolean {
  return stageOf(status) === "waiting";
}

/** Does this improvement count towards someone's tally? */
export function countsForCredit(status: string): boolean {
  return stageOf(status) === "approved";
}
