import { describe, expect, it } from "vitest";
import { desiredHold, holdMatches, type HorizonState, type ExistingHold } from "./stock-gate-decision";

// The stock gate holds a product back from delivery when the packs we have
// won't cover the despatch that's due. Horizon 0 is today's despatch; horizon
// 1 is the next despatch day, which is what stops an evening sales spike
// overselling a day nobody has looked at yet (Graeme, 2026-08-26: "if tonight
// we start selling loads of macaroni cheese for delivery on Friday, I need it
// to automatically cut Friday off").

const horizon = (over: Partial<HorizonState> = {}): HorizonState => ({
  key: "today",
  daysAhead: 0,
  surplus: 50,
  threshold: 5,
  release: 10,
  tag: "low-stock-hold",
  enabled: true,
  ...over,
});

const TODAY = (surplus: number | null) => horizon({ surplus });
const TOMORROW = (surplus: number | null) =>
  horizon({ key: "tomorrow", daysAhead: 1, tag: "low-stock-hold2", surplus });

const heldAs = (horizonKey: string, tag: string, dryRun = false): ExistingHold =>
  ({ horizon: horizonKey, tag, dryRun });

describe("desiredHold — triggering", () => {
  it("holds nothing when both horizons are comfortable", () => {
    expect(desiredHold([TODAY(50), TOMORROW(40)], null)).toBeNull();
  });

  it("holds today when today's despatch is short", () => {
    expect(desiredHold([TODAY(3), TOMORROW(40)], null)).toEqual({
      horizon: "today", tag: "low-stock-hold",
    });
  });

  it("holds tomorrow when tomorrow is short, even though today is fine", () => {
    // The evening-spike case. Blocking tomorrow's delivery slot as well is a
    // consequence of Zapiet preparation time being cumulative, not a choice.
    expect(desiredHold([TODAY(50), TOMORROW(2)], null)).toEqual({
      horizon: "tomorrow", tag: "low-stock-hold2",
    });
  });

  it("takes the furthest horizon when both are short — its tag covers both", () => {
    expect(desiredHold([TODAY(1), TOMORROW(-6)], null)).toEqual({
      horizon: "tomorrow", tag: "low-stock-hold2",
    });
  });

  it("treats being oversold as breaching, not as a negative that reads high", () => {
    expect(desiredHold([TODAY(-20), TOMORROW(40)], null)).toEqual({
      horizon: "today", tag: "low-stock-hold",
    });
  });

  it("ignores a horizon that is switched off", () => {
    expect(desiredHold([TODAY(50), { ...TOMORROW(-30), enabled: false }], null)).toBeNull();
  });
});

describe("desiredHold — unknown data never acts", () => {
  it("does not hold on a surplus it could not compute", () => {
    // A missing plan or a failed Shopify read must not look like zero stock.
    expect(desiredHold([TODAY(50), TOMORROW(null)], null)).toBeNull();
  });

  it("does not release an existing hold on a surplus it could not compute", () => {
    const existing = heldAs("tomorrow", "low-stock-hold2");
    expect(desiredHold([TODAY(50), TOMORROW(null)], existing)).toEqual({
      horizon: "tomorrow", tag: "low-stock-hold2",
    });
  });
});

describe("desiredHold — hysteresis", () => {
  it("keeps a hold that has climbed past the threshold but not the release bar", () => {
    // surplus 7: above threshold 5, below release 10. Letting go here would
    // put the product back on the picker only to pull it again next cycle.
    const existing = heldAs("today", "low-stock-hold");
    expect(desiredHold([TODAY(7), TOMORROW(40)], existing)).toEqual({
      horizon: "today", tag: "low-stock-hold",
    });
  });

  it("releases once the surplus reaches the release bar", () => {
    const existing = heldAs("today", "low-stock-hold");
    expect(desiredHold([TODAY(10), TOMORROW(40)], existing)).toBeNull();
  });
});

describe("desiredHold — moving between horizons", () => {
  it("escalates a today-hold to tomorrow when the forecast worsens", () => {
    const existing = heldAs("today", "low-stock-hold");
    expect(desiredHold([TODAY(2), TOMORROW(-4)], existing)).toEqual({
      horizon: "tomorrow", tag: "low-stock-hold2",
    });
  });

  it("steps a recovered tomorrow-hold back down to today", () => {
    const existing = heldAs("tomorrow", "low-stock-hold2");
    expect(desiredHold([TODAY(1), TOMORROW(30)], existing)).toEqual({
      horizon: "today", tag: "low-stock-hold",
    });
  });

  it("clears a tomorrow-hold entirely once both horizons recover", () => {
    const existing = heldAs("tomorrow", "low-stock-hold2");
    expect(desiredHold([TODAY(40), TOMORROW(30)], existing)).toBeNull();
  });
});

describe("desiredHold — more than two horizons", () => {
  // Graeme, 2026-08-26: "we could just extend this for three or four days".
  const DAY3 = (surplus: number | null) =>
    horizon({ key: "day3", daysAhead: 2, tag: "low-stock-hold3", surplus });

  it("picks the furthest breaching horizon of three", () => {
    expect(desiredHold([TODAY(1), TOMORROW(1), DAY3(-2)], null)).toEqual({
      horizon: "day3", tag: "low-stock-hold3",
    });
  });

  it("does not care what order the horizons arrive in", () => {
    expect(desiredHold([DAY3(-2), TODAY(1), TOMORROW(1)], null)).toEqual({
      horizon: "day3", tag: "low-stock-hold3",
    });
  });
});

describe("holdMatches", () => {
  it("leaves a hold alone when it already says what we want", () => {
    expect(holdMatches(heldAs("today", "low-stock-hold"), { horizon: "today", tag: "low-stock-hold" }, false)).toBe(true);
  });

  it("replaces a dry-run hold once dry run is switched off", () => {
    // The regression: a hold created in dry run was never tagged afterwards,
    // so the product sat held with nothing ever reaching Shopify.
    expect(holdMatches(heldAs("today", "low-stock-hold", true), { horizon: "today", tag: "low-stock-hold" }, false)).toBe(false);
  });

  it("replaces a hold whose tag setting has since been renamed", () => {
    expect(holdMatches(heldAs("today", "old-tag"), { horizon: "today", tag: "low-stock-hold" }, false)).toBe(false);
  });

  it("replaces a hold when the horizon changes", () => {
    expect(holdMatches(heldAs("today", "low-stock-hold"), { horizon: "tomorrow", tag: "low-stock-hold2" }, false)).toBe(false);
  });

  it("agrees that no hold and no need for one already match", () => {
    expect(holdMatches(null, null, false)).toBe(true);
  });

  it("spots a hold that should not be there, and one that should", () => {
    expect(holdMatches(heldAs("today", "low-stock-hold"), null, false)).toBe(false);
    expect(holdMatches(null, { horizon: "today", tag: "low-stock-hold" }, false)).toBe(false);
  });
});
