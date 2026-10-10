/**
 * The one-off "swipe left from the right of the screen" walkthrough
 * (Graeme, 2026-10-09; reworked 2026-10-10 when the panel started opening
 * from anywhere on the right half; Objective H). Pure; tested in
 * swipe-tour.test.ts.
 *
 *   intro  → "Try it now"           → try
 *   try    → the panel is pulled out → swipe_away
 *   swipe_away → the panel is shut   → done
 *   done   → "Got it" (saved for the person, never shown again)
 *
 * WHEN: once per person (stored on the server), at any page — but never
 * over the PIN pad or another must-answer prompt, and never on the kiosk,
 * meeting, scan or print pages (the same pages the emergency-contact card
 * stays off). "Show me later" lasts until the next page load.
 */
import { promptHiddenOnPath } from "./emergency-contacts";

/** Bumped from "swipe_panel" on 2026-10-10: the gesture changed, so everyone
 *  (including those who finished the old walkthrough) sees the new one once.
 *  Server keys must match /^[a-z0-9_]{1,40}$/. */
export const SWIPE_TOUR_KEY = "swipe_panel_v2";

export type TourStep = "intro" | "try" | "swipe_away" | "done";

export type TourEvent = "start" | "panel_opened" | "panel_closed";

export function nextTourStep(step: TourStep, event: TourEvent): TourStep {
  if (step === "intro" && event === "start") return "try";
  // Swiped it open straight from the intro card (the swipe works anywhere
  // on the right now): skip ahead — leaving the intro card over the open
  // panel hid the buttons.
  if (step === "intro" && event === "panel_opened") return "swipe_away";
  if (step === "try" && event === "panel_opened") return "swipe_away";
  // If they shut it some other way mid-"try" nothing changes; from
  // "swipe_away", any close completes it — the X or a tap outside still
  // shows they can get rid of it.
  if (step === "swipe_away" && event === "panel_closed") return "done";
  return step;
}

export function shouldShowTour(f: {
  /** Loaded from the server; undefined while loading or on error. */
  completed: string[] | undefined;
  laterThisLoad: boolean;
  pinLocked: boolean;
  otherPromptShowing: boolean;
  path: string;
}): boolean {
  if (!f.completed || f.completed.includes(SWIPE_TOUR_KEY)) return false;
  if (f.laterThisLoad || f.pinLocked || f.otherPromptShowing) return false;
  return !promptHiddenOnPath(f.path);
}
