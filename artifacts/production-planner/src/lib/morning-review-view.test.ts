import { describe, expect, it } from "vitest";
import {
  LIST_CLOSED_QUIET_MS, morningReviewView, PANEL_QUIET_MS, quietAfterChange, quietAfterListClosed, quietWhileWorkingInPanel, reviewHeadline,
  todosOnScreen, type MorningReviewInput,
} from "./morning-review-view";

const base: MorningReviewInput = { due: true, list: "none", checkinShowing: false, otherDialogOpen: false, quiet: null, now: 1_000_000, path: "/" };

describe("morningReviewView", () => {
  it("shows the takeover when due and the list is shut", () => {
    expect(morningReviewView(base)).toBe("takeover");
  });

  it("shows nothing when not due (off, before 8am, done today or snoozed)", () => {
    expect(morningReviewView({ ...base, due: false })).toBe("none");
    expect(morningReviewView({ ...base, due: false, list: "covering" })).toBe("none");
  });

  it("shows the banner, not the takeover, while the real list is open", () => {
    expect(morningReviewView({ ...base, list: "covering" })).toBe("banner");
    expect(morningReviewView({ ...base, list: "covering", quiet: quietAfterListClosed(base.now, "/") })).toBe("banner");
  });

  it("waits for the daily check-in", () => {
    expect(morningReviewView({ ...base, checkinShowing: true })).toBe("none");
  });

  it("waits while another modal dialog is open (its buttons would be dead under it)", () => {
    expect(morningReviewView({ ...base, otherDialogOpen: true })).toBe("none");
  });

  it("stays quiet after the list is closed unfinished, on the same page, for five minutes", () => {
    const quiet = quietAfterListClosed(base.now, "/orders");
    const at = (ms: number, path = "/orders") => morningReviewView({ ...base, quiet, now: base.now + ms, path });
    expect(at(0)).toBe("none");
    expect(at(LIST_CLOSED_QUIET_MS - 1)).toBe("none");
    expect(at(LIST_CLOSED_QUIET_MS)).toBe("takeover");
  });

  it("comes back as soon as the person moves to another page", () => {
    const quiet = quietAfterListClosed(base.now, "/orders");
    expect(morningReviewView({ ...base, quiet, now: base.now + 1000, path: "/dashboard" })).toBe("takeover");
  });
});

describe("the docked panel", () => {
  it("never suppresses the review — it can be open all day", () => {
    expect(morningReviewView({ ...base, list: "docked" })).toBe("takeover");
    // …still open the next morning, on whatever page.
    expect(morningReviewView({ ...base, list: "docked", now: base.now + 24 * 3600_000, path: "/orders" })).toBe("takeover");
  });

  it("still waits for the check-in and other dialogs", () => {
    expect(morningReviewView({ ...base, list: "docked", checkinShowing: true })).toBe("none");
    expect(morningReviewView({ ...base, list: "docked", otherDialogOpen: true })).toBe("none");
  });

  it("is not the list being open; the full-screen list on top of it is", () => {
    expect(todosOnScreen({ covering: false, docked: true })).toBe("docked");
    expect(todosOnScreen({ covering: true, docked: true })).toBe("covering");
    expect(todosOnScreen({ covering: false, docked: false })).toBe("none");
  });

  it("opened from the review: keeps out of the way on any page, for twenty minutes", () => {
    const quiet = quietWhileWorkingInPanel(base.now);
    const at = (ms: number, path: string) => morningReviewView({ ...base, list: "docked", quiet, now: base.now + ms, path });
    expect(at(0, "/")).toBe("none");
    expect(at(10 * 60_000, "/orders")).toBe("none");
    expect(at(PANEL_QUIET_MS, "/orders")).toBe("takeover");
  });

  it("closing that panel unfinished is closing the list: five minutes or the next page", () => {
    const working = quietWhileWorkingInPanel(base.now);
    const closed = quietAfterChange("docked", "none", working, base.now + 60_000, "/orders");
    expect(closed).toEqual(quietAfterListClosed(base.now + 60_000, "/orders"));
  });

  it("a panel nobody opened from the review changes nothing when it opens or closes", () => {
    expect(quietAfterChange("none", "docked", null, base.now, "/")).toBeNull();
    expect(quietAfterChange("docked", "none", null, base.now, "/")).toBeNull();
    const old = quietWhileWorkingInPanel(base.now - PANEL_QUIET_MS);
    expect(quietAfterChange("docked", "none", old, base.now, "/")).toBe(old);
  });

  it("closing the full-screen list starts the short spell, panel or not", () => {
    expect(quietAfterChange("covering", "none", null, base.now, "/")).toEqual(quietAfterListClosed(base.now, "/"));
    expect(quietAfterChange("covering", "docked", null, base.now, "/")).toEqual(quietAfterListClosed(base.now, "/"));
  });
});

describe("reviewHeadline", () => {
  it("counts open and overdue to-dos", () => {
    expect(reviewHeadline(0, 0)).toBe("Your list is clear");
    expect(reviewHeadline(1, 0)).toBe("1 open to-do");
    expect(reviewHeadline(7, 2)).toBe("7 open to-dos (2 overdue)");
  });
});
