import { describe, expect, it } from "vitest";
import { isLookedAt, scrolledPastAfterReading, SEEN_DWELL_MS } from "./seen-on-scroll";

describe("auto 'I've seen this' on scroll (2026-10-01)", () => {
  it("half a normal card on screen counts as looking at it", () => {
    expect(isLookedAt(150, 300, 800)).toBe(true);
    expect(isLookedAt(100, 300, 800)).toBe(false);
  });
  it("a card taller than the screen counts once it fills half the screen", () => {
    expect(isLookedAt(400, 1600, 800)).toBe(true);
    expect(isLookedAt(300, 1600, 800)).toBe(false);
  });
  it("only counts once read for long enough AND scrolled off the top", () => {
    expect(scrolledPastAfterReading(SEEN_DWELL_MS, -5, 0)).toBe(true);
    expect(scrolledPastAfterReading(SEEN_DWELL_MS - 1, -5, 0)).toBe(false); // flicked past
    expect(scrolledPastAfterReading(SEEN_DWELL_MS * 3, 200, 0)).toBe(false); // still on screen / scrolled back up
  });
  it("nothing to measure is never looked at", () => {
    expect(isLookedAt(0, 0, 800)).toBe(false);
  });
});
