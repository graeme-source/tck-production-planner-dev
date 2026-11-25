/**
 * What the 8am to-do review shows right now (Graeme, 2026-10-24: "it just
 * needs to force me to go into the actual to-do list, not to show a preview
 * of it"). Objective E.
 *
 * - "takeover": the compact screen-covering card with ONE big "Open my to-do
 *   list" button (and "Not now — 30 min").
 * - "banner": the real to-do list is open over the whole screen, so a slim
 *   strip at the top of it says what to do and carries "I've reviewed my list".
 * - "none": not due (off, before 8am, done today or snoozed — the server
 *   rule in api-server lib/todo-review.ts), or waiting its turn.
 *
 * The docked panel (25 Nov 2026) is NOT the list being open: it can sit beside
 * the page all day, and then the review would never come up. The takeover
 * pops up over it as if it weren't there. Its "Open my to-do list" opens (or
 * returns to) the panel, which carries the same strip, and the takeover keeps
 * out of the way while that panel stays up — on any page, since moving round
 * the app ticking things off is the point — but for twenty minutes at most.
 * Closing the panel unfinished is the same as closing the list.
 *
 * Closing the list without finishing leaves the review due. So the app stays
 * usable, the takeover then keeps quiet until the person moves to another
 * page OR five minutes pass, whichever comes first — then it's back. The
 * 30-minute snooze is the server's and simply makes the review not due.
 */

/** How long the takeover stays away after the list is closed unfinished. */
export const LIST_CLOSED_QUIET_MS = 5 * 60_000;

/** How long it stays away while the panel it opened is being worked through. */
export const PANEL_QUIET_MS = 20 * 60_000;

export type MorningReviewView = "none" | "takeover" | "banner";

/** Quiet until this time. `path`: only on this page (the list was closed
 *  without finishing); null: on any page (working in the docked panel). */
export interface ReviewQuiet {
  until: number;
  path: string | null;
}

/** Where the to-dos are showing: not at all, over the whole screen (the
 *  full-screen list; the panel on a phone), or in the panel beside the page. */
export type TodosOnScreen = "none" | "covering" | "docked";

export function todosOnScreen(i: { covering: boolean; docked: boolean }): TodosOnScreen {
  return i.covering ? "covering" : i.docked ? "docked" : "none";
}

export interface MorningReviewInput {
  /** The server says the review is due (on, 8am+, not done today, not snoozed). */
  due: boolean;
  /** Where the to-dos are showing. */
  list: TodosOnScreen;
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
  if (i.list === "covering") return "banner";
  if (i.checkinShowing || i.otherDialogOpen) return "none";
  if (quietActive(i.quiet, i.now, i.path)) return "none";
  return "takeover";
}

export function quietActive(q: ReviewQuiet | null, now: number, path: string): boolean {
  return !!q && now < q.until && (q.path === null || path === q.path);
}

export function quietAfterListClosed(now: number, path: string): ReviewQuiet {
  return { until: now + LIST_CLOSED_QUIET_MS, path };
}

/** "Open my to-do list" opened the docked panel. */
export function quietWhileWorkingInPanel(now: number): ReviewQuiet {
  return { until: now + PANEL_QUIET_MS, path: null };
}

/** The list or panel has just changed: the quiet spell that starts, or the
 *  one already running. Closing either without finishing starts the short
 *  one; a panel nobody opened from the review starts nothing. */
export function quietAfterChange(prev: TodosOnScreen, next: TodosOnScreen, quiet: ReviewQuiet | null, now: number, path: string): ReviewQuiet | null {
  if (prev === "covering" && next !== "covering") return quietAfterListClosed(now, path);
  const workingInPanel = quietActive(quiet, now, path) && quiet?.path === null;
  if (prev === "docked" && next === "none" && workingInPanel) return quietAfterListClosed(now, path);
  return quiet;
}

/** The headline on the takeover card. */
export function reviewHeadline(open: number, overdue: number): string {
  if (open === 0) return "Your list is clear";
  const base = `${open} open to-do${open === 1 ? "" : "s"}`;
  return overdue > 0 ? `${base} (${overdue} overdue)` : base;
}
