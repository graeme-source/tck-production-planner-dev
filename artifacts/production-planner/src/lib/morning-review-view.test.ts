import { describe, expect, it } from "vitest";
import { LIST_CLOSED_QUIET_MS, morningReviewView, quietAfterListClosed, reviewHeadline, type MorningReviewInput } from "./morning-review-view";

const base: MorningReviewInput = { due: true, listOpen: false, checkinShowing: false, otherDialogOpen: false, quiet: null, now: 1_000_000, path: "/" };

describe("morningReviewView", () => {
  it("shows the takeover when due and the list is shut", () => {
    expect(morningReviewView(base)).toBe("takeover");
  });

  it("shows nothing when not due (off, before 8am, done today or snoozed)", () => {
    expect(morningReviewView({ ...base, due: false })).toBe("none");
    expect(morningReviewView({ ...base, due: false, listOpen: true })).toBe("none");
  });

  it("shows the banner, not the takeover, while the real list is open", () => {
    expect(morningReviewView({ ...base, listOpen: true })).toBe("banner");
    expect(morningReviewView({ ...base, listOpen: true, quiet: quietAfterListClosed(base.now, "/") })).toBe("banner");
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

describe("reviewHeadline", () => {
  it("counts open and overdue to-dos", () => {
    expect(reviewHeadline(0, 0)).toBe("Your list is clear");
    expect(reviewHeadline(1, 0)).toBe("1 open to-do");
    expect(reviewHeadline(7, 2)).toBe("7 open to-dos (2 overdue)");
  });
});
