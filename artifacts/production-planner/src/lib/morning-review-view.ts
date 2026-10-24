/**
 * What the 8am to-do review shows right now (Graeme, 2026-10-24: "it just
 * needs to force me to go into the actual to-do list, not to show a preview
 * of it"). Objective E.
 *
 * - "takeover": the compact screen-covering card with ONE big "Open my to-do
 *   list" button (and "Not now — 30 min").
 * - "banner": the real to-do list is open, so a slim strip at the top of it
 *   says what to do and carries "I've reviewed my list".
 * - "none": not due (off, before 8am, done today or snoozed — the server
 *   rule in api-server lib/todo-review.ts), or waiting its turn.
 *
 * Closing the list without finishing leaves the review due. So the app stays
 * usable, the takeover then keeps quiet until the person moves to another
 * page OR five minutes pass, whichever comes first — then it's back. The
 * 30-minute snooze is the server's and simply makes the review not due.
 */

/** How long the takeover stays away after the list is closed unfinished. */
export const LIST_CLOSED_QUIET_MS = 5 * 60_000;

export type MorningReviewView = "none" | "takeover" | "banner";

/** Set when the list is closed without finishing: quiet until this time, on this page. */
export interface ReviewQuiet {
  until: number;
  path: string;
}

export interface MorningReviewInput {
  /** The server says the review is due (on, 8am+, not done today, not snoozed). */
  due: boolean;
  /** The real to-do list is open on screen. */
  listOpen: boolean;
  /** The daily improvement check-in is up — the takeover waits for it. */
  checkinShowing: boolean;
  /** Another modal dialog (e.g. the weekly DPT suggestion) is open. A modal
   *  dialog makes everything outside it unclickable, so the takeover's own
   *  buttons would be dead — it waits its turn instead. */
  otherDialogOpen: boolean;
  quiet: ReviewQuiet | null;
  now: number;
  /** The current page's path. */
  path: string;
}

export function morningReviewView(i: MorningReviewInput): MorningReviewView {
  if (!i.due) return "none";
  if (i.listOpen) return "banner";
  if (i.checkinShowing || i.otherDialogOpen) return "none";
  if (quietActive(i.quiet, i.now, i.path)) return "none";
  return "takeover";
}

export function quietActive(q: ReviewQuiet | null, now: number, path: string): boolean {
  return !!q && now < q.until && path === q.path;
}

export function quietAfterListClosed(now: number, path: string): ReviewQuiet {
  return { until: now + LIST_CLOSED_QUIET_MS, path };
}

/** The headline on the takeover card. */
export function reviewHeadline(open: number, overdue: number): string {
  if (open === 0) return "Your list is clear";
  const base = `${open} open to-do${open === 1 ? "" : "s"}`;
  return overdue > 0 ? `${base} (${overdue} overdue)` : base;
}
