import { describe, expect, it } from "vitest";
import { hasThread, sendStateLabel, threadCountsLabel, threadCountsSpoken } from "./improvement-thread";

describe("the Comments & photos button", () => {
  it("shows comment and photo counts", () => {
    expect(threadCountsLabel({ commentCount: 3, commentPhotoCount: 2 })).toBe("💬 3 · 📷 2");
    expect(threadCountsLabel({ commentCount: 1, commentPhotoCount: 0 })).toBe("💬 1");
    expect(threadCountsLabel({ commentCount: 0, commentPhotoCount: 2 })).toBe("📷 2");
  });

  it("has no counts when there's nothing yet (or the server sent none)", () => {
    expect(threadCountsLabel({ commentCount: 0, commentPhotoCount: 0 })).toBeNull();
    expect(threadCountsLabel({})).toBeNull();
    expect(hasThread({})).toBe(false);
    expect(hasThread({ commentPhotoCount: 1 })).toBe(true);
  });

  it("says it in words for screen readers", () => {
    expect(threadCountsSpoken({ commentCount: 1, commentPhotoCount: 2 })).toBe("Comments & photos: 1 comment and 2 photos");
    expect(threadCountsSpoken({})).toBe("No comments yet — add a comment");
  });

  it("names every send state", () => {
    expect(sendStateLabel("sending")).toBe("Sending…");
    expect(sendStateLabel("sent")).toBe("Sent ✓");
    expect(sendStateLabel("failed")).toBe("Couldn't send");
    expect(sendStateLabel("idle")).toBe("Send");
  });
});
