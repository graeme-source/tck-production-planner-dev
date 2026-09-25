import { describe, it, expect } from "vitest";
import {
  CUTOVER_CONTINUITY_MS,
  cutoverPassedWhileAway,
  nextStreakStart,
  shouldDeferCutover,
} from "./pin-cutover-client";

const t = (iso: string) => new Date(iso).getTime();
const MIN = 60_000;

// Fri 25 Sep 2026 (BST): morning reset 04:00 UTC = 05:00 London; evening
// reset 22:00 London = 21:00 UTC.
const MORNING_RESET = t("2026-09-25T04:00:00Z");
const EVENING_RESET = t("2026-09-24T21:00:00Z");

/** Replays a sequence of touches through nextStreakStart. */
function replay(touches: number[]) {
  let lastActivity = 0;
  let streakStart = 0;
  for (const now of touches) {
    streakStart = nextStreakStart({ lastActivity, streakStart }, now);
    lastActivity = now;
  }
  return { lastActivity, streakStart };
}

describe("nextStreakStart", () => {
  it("starts a streak on the first touch", () => {
    expect(nextStreakStart({ lastActivity: 0, streakStart: 0 }, 1000)).toBe(1000);
  });

  it("carries the streak while touches keep coming", () => {
    const s = replay([t("2026-09-24T20:40:00Z"), t("2026-09-24T20:50:00Z"), t("2026-09-24T21:04:00Z")]);
    expect(s.streakStart).toBe(t("2026-09-24T20:40:00Z"));
  });

  it("a pause of the continuity window or more starts a new streak", () => {
    const s = replay([t("2026-09-24T20:40:00Z"), t("2026-09-24T20:40:00Z") + CUTOVER_CONTINUITY_MS]);
    expect(s.streakStart).toBe(t("2026-09-24T20:40:00Z") + CUTOVER_CONTINUITY_MS);
  });
});

describe("shouldDeferCutover", () => {
  // Regression, Fri 25 Sep 2026: iPad last touched 23:42 London, woken 07:29.
  // Its first taps made it look "active", so the old rule deferred the lock
  // and 16 batches went down as Grant's.
  it("morning wake: a device asleep through the reset locks, even after its first taps", () => {
    const lastNight = t("2026-09-24T22:42:00Z");
    const wake = t("2026-09-25T06:29:00Z");
    const s = replay([lastNight, wake, wake + 5_000]);
    expect(shouldDeferCutover({
      now: wake + 6_000,
      resetAt: MORNING_RESET,
      lastActivity: s.lastActivity,
      streakStart: s.streakStart,
      lockAlreadyApplied: false,
    })).toBe(false);
  });

  it("morning wake before any tap also locks", () => {
    expect(shouldDeferCutover({
      now: t("2026-09-25T06:29:00Z"),
      resetAt: MORNING_RESET,
      lastActivity: t("2026-09-24T22:42:00Z"),
      streakStart: t("2026-09-24T22:30:00Z"),
      lockAlreadyApplied: false,
    })).toBe(false);
  });

  it("someone typing across 10pm is still deferred", () => {
    const s = replay([
      t("2026-09-24T20:45:00Z"),
      t("2026-09-24T20:55:00Z"),
      t("2026-09-24T21:02:00Z"),
      t("2026-09-24T21:10:00Z"),
    ]);
    expect(shouldDeferCutover({
      now: t("2026-09-24T21:12:00Z"),
      resetAt: EVENING_RESET,
      lastActivity: s.lastActivity,
      streakStart: s.streakStart,
      lockAlreadyApplied: false,
    })).toBe(true);
  });

  it("…until they stop for the continuity window", () => {
    const s = replay([t("2026-09-24T20:45:00Z"), t("2026-09-24T21:10:00Z") - 14 * MIN, t("2026-09-24T21:10:00Z")]);
    expect(shouldDeferCutover({
      now: t("2026-09-24T21:10:00Z") + CUTOVER_CONTINUITY_MS,
      resetAt: EVENING_RESET,
      lastActivity: s.lastActivity,
      streakStart: s.streakStart,
      lockAlreadyApplied: false,
    })).toBe(false);
  });

  it("someone who stopped before 10pm and comes back after is locked", () => {
    const s = replay([t("2026-09-24T20:30:00Z"), t("2026-09-24T21:05:00Z")]);
    expect(shouldDeferCutover({
      now: t("2026-09-24T21:06:00Z"),
      resetAt: EVENING_RESET,
      lastActivity: s.lastActivity,
      streakStart: s.streakStart,
      lockAlreadyApplied: false,
    })).toBe(false);
  });

  it("an already-applied lock is never deferred", () => {
    expect(shouldDeferCutover({
      now: t("2026-09-24T21:05:00Z"),
      resetAt: EVENING_RESET,
      lastActivity: t("2026-09-24T21:04:00Z"),
      streakStart: t("2026-09-24T20:00:00Z"),
      lockAlreadyApplied: true,
    })).toBe(false);
  });

  it("an unknown reset time never defers", () => {
    expect(shouldDeferCutover({
      now: t("2026-09-24T21:05:00Z"),
      resetAt: null,
      lastActivity: t("2026-09-24T21:04:00Z"),
      streakStart: t("2026-09-24T20:00:00Z"),
      lockAlreadyApplied: false,
    })).toBe(false);
  });
});

describe("cutoverPassedWhileAway", () => {
  it("locks on wake when the expected reset has passed while the device slept", () => {
    expect(cutoverPassedWhileAway({
      now: t("2026-09-25T06:29:00Z"),
      nextResetAt: MORNING_RESET,
      lastActivity: t("2026-09-24T22:42:00Z"),
      streakStart: t("2026-09-24T22:30:00Z"),
      lockAlreadyApplied: false,
    })).toBe(true);
  });

  it("does nothing before the reset", () => {
    expect(cutoverPassedWhileAway({
      now: t("2026-09-25T03:59:00Z"),
      nextResetAt: MORNING_RESET,
      lastActivity: t("2026-09-24T22:42:00Z"),
      streakStart: t("2026-09-24T22:30:00Z"),
      lockAlreadyApplied: false,
    })).toBe(false);
  });

  it("does not lock someone who has been working straight through the reset", () => {
    expect(cutoverPassedWhileAway({
      now: t("2026-09-24T21:03:00Z"),
      nextResetAt: EVENING_RESET,
      lastActivity: t("2026-09-24T21:02:00Z"),
      streakStart: t("2026-09-24T20:40:00Z"),
      lockAlreadyApplied: false,
    })).toBe(false);
  });

  it("does nothing when the next reset is unknown", () => {
    expect(cutoverPassedWhileAway({
      now: t("2026-09-25T06:29:00Z"),
      nextResetAt: null,
      lastActivity: 0,
      streakStart: 0,
      lockAlreadyApplied: false,
    })).toBe(false);
  });
});
