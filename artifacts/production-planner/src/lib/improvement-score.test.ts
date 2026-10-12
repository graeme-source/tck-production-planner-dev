import { describe, expect, it } from "vitest";
import { creditBadge, normaliseCreditWeight, scoreBand, scoreBarFill, scoreDetail, scoreText } from "./improvement-score";

describe("improvement score on screen", () => {
  it("shows the real number, uncapped, and '—' with no score", () => {
    expect(scoreText(200)).toBe("200%");
    expect(scoreText(450)).toBe("450%");
    expect(scoreText(0)).toBe("0%");
    expect(scoreText(null)).toBe("—");
  });

  it("fills the bar to 200% and no further", () => {
    expect(scoreBarFill(100)).toBe(50);
    expect(scoreBarFill(200)).toBe(100);
    expect(scoreBarFill(450)).toBe(100);
    expect(scoreBarFill(null)).toBe(0);
    expect(scoreBarFill(0)).toBe(0);
  });

  it("bands the colour around one a shift", () => {
    expect(scoreBand(null)).toBe("none");
    expect(scoreBand(60)).toBe("under");
    expect(scoreBand(100)).toBe("on");
    expect(scoreBand(160)).toBe("above");
  });

  it("spells out credits, shifts and the all-time count", () => {
    expect(scoreDetail({ credits30: 6, shifts30: 3, count: 14 })).toBe("6 credits · 3 shifts · 14 all-time");
    expect(scoreDetail({ credits30: 1, shifts30: 1, count: 1 })).toBe("1 credit · 1 shift · 1 all-time");
    expect(scoreDetail({ credits30: 2, shifts30: null, count: 5 })).toBe("2 credits · shifts not linked · 5 all-time");
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
