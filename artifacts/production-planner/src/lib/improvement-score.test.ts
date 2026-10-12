import { describe, expect, it } from "vitest";
import { LEANER_TARGETS, creditBadge, leanerStep, normaliseCreditWeight, scoreDetail, scoreText, stepBarFill } from "./improvement-score";

describe("improvement score on screen", () => {
  it("shows the real number, uncapped, and '—' with no score", () => {
    expect(scoreText(200)).toBe("200%");
    expect(scoreText(8)).toBe("8%");
    expect(scoreText(0)).toBe("0%");
    expect(scoreText(null)).toBe("—");
  });

  it("shows the plain count and the shifts so the maths is visible", () => {
    expect(scoreDetail({ improvements30: 4, credits30: 4, shifts30: 10 })).toBe("4 improvements · 10 shifts");
    expect(scoreDetail({ improvements30: 1, credits30: 1, shifts30: 1 })).toBe("1 improvement · 1 shift");
  });

  it("names a ×2/×3 bonus only when it changes the sum", () => {
    expect(scoreDetail({ improvements30: 3, credits30: 5, shifts30: 12 })).toBe("3 improvements · 12 shifts · counts as 5 with ×2/×3");
  });

  it("says why there's no score", () => {
    expect(scoreDetail({ improvements30: 2, credits30: 2, shifts30: 0 })).toBe("2 improvements · no shifts in the last 30 days");
    expect(scoreDetail({ improvements30: 2, credits30: 4, shifts30: null })).toBe("2 improvements · shifts not linked to Planday");
  });
});

describe("encouraging steps", () => {
  const step = (scorePct: number | null, improvements30: number, count = improvements30) =>
    leanerStep({ scorePct, improvements30, count });

  it("targets are 20% then 50%", () => {
    expect(LEANER_TARGETS).toEqual([20, 50]);
  });

  it("nothing yet: the first improvement is waiting", () => {
    expect(step(0, 0)).toEqual({
      key: "waiting", nextPct: 20,
      message: "Your first improvement is waiting — what's one thing that annoyed you this week?",
    });
  });

  it("nothing this month but some before: the NEXT one is waiting", () => {
    expect(step(0, 0, 6)?.message).toBe("Your next improvement is waiting — what's one thing that annoyed you this week?");
  });

  it("8% is a great start, next stop 20%", () => {
    expect(step(8, 1)).toEqual({ key: "started", nextPct: 20, message: "Great — you've made a start. Next stop: 20%" });
    expect(step(19, 3)?.key).toBe("started");
  });

  it("20% up to 50%: on to 50%", () => {
    expect(step(20, 2)).toEqual({ key: "rolling", nextPct: 50, message: "Brilliant — on to 50%" });
    expect(step(49, 5)?.key).toBe("rolling");
  });

  it("50% and up: Leaner legend", () => {
    expect(step(50, 5)).toEqual({ key: "legend", nextPct: null, message: "Leaner legend" });
    expect(step(300, 9)?.key).toBe("legend");
  });

  it("no shifts, no step — just the count", () => {
    expect(step(null, 3)).toBeNull();
    expect(step(null, 0)).toBeNull();
  });

  it("no message ever says low or scolds", () => {
    for (const [pct, n] of [[0, 0], [3, 1], [25, 2], [80, 8]] as const) {
      expect(step(pct, n)?.message.toLowerCase()).not.toMatch(/low|poor|bad|behind/);
    }
  });
});

describe("the bar fills towards the next stop", () => {
  it("8% is 40% of the way to 20%", () => {
    expect(stepBarFill(8, 20)).toBe(40);
  });
  it("30% is 60% of the way to 50%", () => {
    expect(stepBarFill(30, 50)).toBe(60);
  });
  it("full for a legend, empty for nothing yet", () => {
    expect(stepBarFill(120, null)).toBe(100);
    expect(stepBarFill(0, 20)).toBe(0);
    expect(stepBarFill(null, 20)).toBe(0);
  });
});

describe("×2 / ×3 badge", () => {
  it("only marks the special ones", () => {
    expect(creditBadge(1)).toBeNull();
    expect(creditBadge(undefined)).toBeNull();
    expect(creditBadge(2)).toBe("×2 — great one");
    expect(creditBadge(3)).toBe("×3 — substantial");
    expect(normaliseCreditWeight(9)).toBe(1);
  });
});
