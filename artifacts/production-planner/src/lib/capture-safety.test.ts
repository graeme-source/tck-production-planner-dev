import { describe, it, expect } from "vitest";
import { stashIsFresh, STASH_FRESH_MS } from "./capture-safety";

// Regression guard for the 2026-09-14 lost after-video: a stashed capture
// must stay recoverable for a working-day-plus, and clocks that misbehave
// must not resurrect ancient blobs.
describe("stashIsFresh", () => {
  const now = 1_800_000_000_000;

  it("a capture from moments ago is fresh", () => {
    expect(stashIsFresh(now - 60_000, now)).toBe(true);
  });

  it("a capture from yesterday is still fresh — redo happens next shift", () => {
    expect(stashIsFresh(now - 24 * 60 * 60 * 1000, now)).toBe(true);
  });

  it("exactly at the 48h boundary is fresh", () => {
    expect(stashIsFresh(now - STASH_FRESH_MS, now)).toBe(true);
  });

  it("older than 48h is stale", () => {
    expect(stashIsFresh(now - STASH_FRESH_MS - 1, now)).toBe(false);
  });

  it("a timestamp from the future is not fresh (clock skew)", () => {
    expect(stashIsFresh(now + 60_000, now)).toBe(false);
  });
});
