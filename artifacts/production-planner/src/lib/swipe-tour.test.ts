import { describe, it, expect } from "vitest";
import { nextTourStep, shouldShowTour, SWIPE_TOUR_KEY } from "./swipe-tour";

describe("nextTourStep", () => {
  it("walks intro → try → swipe away → done", () => {
    expect(nextTourStep("intro", "start")).toBe("try");
    expect(nextTourStep("try", "panel_opened")).toBe("swipe_away");
    expect(nextTourStep("swipe_away", "panel_closed")).toBe("done");
  });
  it("ignores events out of turn", () => {
    expect(nextTourStep("intro", "panel_opened")).toBe("intro");
    expect(nextTourStep("try", "panel_closed")).toBe("try");
    expect(nextTourStep("done", "panel_opened")).toBe("done");
  });
});

describe("shouldShowTour", () => {
  const base = { completed: [] as string[], laterThisLoad: false, pinLocked: false, otherPromptShowing: false, path: "/" };
  it("shows once, to someone who hasn't done it", () => {
    expect(shouldShowTour(base)).toBe(true);
    expect(shouldShowTour({ ...base, completed: [SWIPE_TOUR_KEY] })).toBe(false);
  });
  it("waits while loading, after 'Show me later', and behind the PIN pad or another prompt", () => {
    expect(shouldShowTour({ ...base, completed: undefined })).toBe(false);
    expect(shouldShowTour({ ...base, laterThisLoad: true })).toBe(false);
    expect(shouldShowTour({ ...base, pinLocked: true })).toBe(false);
    expect(shouldShowTour({ ...base, otherPromptShowing: true })).toBe(false);
  });
  it("never shows on the visitor kiosk, meeting, scan or print pages", () => {
    for (const path of ["/visitor-check-in", "/meeting", "/meeting/3", "/scan", "/print/labels"]) {
      expect(shouldShowTour({ ...base, path })).toBe(false);
    }
  });
});
