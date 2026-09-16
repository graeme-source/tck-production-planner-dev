import { describe, it, expect } from "vitest";
import { shouldShowPostOvenReminder } from "./post-oven-reminder";

describe("shouldShowPostOvenReminder", () => {
  it("fires for a post-oven recipe that just became the open one — the auto-expand regression", () => {
    // 2026-09-17 report: garlic recipe first in the queue auto-expanded and
    // the reminder never showed. The rule must not care HOW it opened.
    expect(shouldShowPostOvenReminder({ expandedItemId: 7, postOvenCount: 1, dismissedItemIds: new Set() })).toBe(true);
  });

  it("stays quiet for recipes without post-oven items", () => {
    expect(shouldShowPostOvenReminder({ expandedItemId: 7, postOvenCount: 0, dismissedItemIds: new Set() })).toBe(false);
  });

  it("shows once per item per session — Complete dismisses it", () => {
    expect(shouldShowPostOvenReminder({ expandedItemId: 7, postOvenCount: 1, dismissedItemIds: new Set([7]) })).toBe(false);
  });

  it("does nothing when no recipe is open", () => {
    expect(shouldShowPostOvenReminder({ expandedItemId: null, postOvenCount: 1, dismissedItemIds: new Set() })).toBe(false);
  });
});
