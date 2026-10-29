import { describe, expect, it } from "vitest";
import { DEFAULT_BONUS_SCHEME as S, bonusFor, bonusLadder, revenueBonus } from "./staff-bonus";

describe("revenueBonus — the table agreed on 27 Oct (minimum £110k, stretch £130k)", () => {
  it.each([
    [109_999, 0], [110_000, 50], [115_000, 78], [120_000, 163], [125_000, 303],
    [130_000, 500], [135_000, 550], [140_000, 600], [155_000, 750], [200_000, 750],
  ])("£%i pays £%i", (revenue, bonus) => {
    expect(revenueBonus(revenue, 110_000, 130_000, S)).toBe(bonus);
  });

  it("a straight-line curve pays half-way at half-way", () => {
    expect(revenueBonus(120_000, 110_000, 130_000, { ...S, curve: 1 })).toBe(275);
  });
});

describe("bonusFor — the bonus never takes profit below 5% of revenue", () => {
  const base = { revenue: 130_000, minimum: 110_000, stretch: 130_000 };
  it("pays in full when there's room above the 5%", () => {
    expect(bonusFor({ ...base, profit: 7_000 }, S)).toMatchObject({ profitFloor: 6_500, room: 500, paid: 500, cost: 575, reason: "full" });
  });
  it("cuts it to the room left", () => {
    expect(bonusFor({ ...base, profit: 6_600 }, S)).toMatchObject({ room: 100, paid: 100, reason: "cut-by-profit" });
  });
  it("pays nothing below the 5%, or at a loss", () => {
    expect(bonusFor({ ...base, profit: 6_000 }, S)).toMatchObject({ paid: 0, reason: "no-profit-room" });
    expect(bonusFor({ ...base, profit: -2_000 }, S)).toMatchObject({ paid: 0 });
  });
  it("pays nothing under the minimum whatever the profit", () => {
    expect(bonusFor({ ...base, revenue: 100_000, profit: 50_000 }, S)).toMatchObject({ paid: 0, reason: "below-minimum" });
  });
});

describe("bonusLadder", () => {
  it("runs minimum → stretch in quarters, then steps to the cap, with the profit each needs", () => {
    const l = bonusLadder(110_000, 130_000, S);
    expect(l.map(r => r.revenue)).toEqual([110_000, 115_000, 120_000, 125_000, 130_000, 135_000, 140_000, 145_000, 150_000, 155_000]);
    expect(l[4]).toEqual({ revenue: 130_000, bonus: 500, profitNeeded: 7_000 });
    expect(l.at(-1)?.bonus).toBe(750);
  });
});
