import { describe, it, expect } from "vitest";
import { salesMomentum } from "./sales-momentum";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 26, 10);
const at = (daysAgo: number, packs: number, cancelled = false) => ({ createdAt: NOW - daysAgo * DAY, cancelledAt: cancelled ? NOW - DAY : null, packs });

describe("salesMomentum", () => {
  it("normal week → no nudge", () => {
    const orders = [at(1, 1000), at(10, 1000), at(17, 1000), at(24, 1000), at(31, 1000)];
    expect(salesMomentum(orders, NOW)).toMatchObject({ last7: 1000, normal7: 1000, ratio: 1, factor: 1 });
  });
  it("selling 20% more → late orders nudged up 10%", () => {
    const orders = [at(1, 1200), at(10, 1000), at(17, 1000), at(24, 1000), at(31, 1000)];
    expect(salesMomentum(orders, NOW).factor).toBeCloseTo(1.1);
  });
  it("a huge week is capped at +25%, a dead one at −25%", () => {
    const base = [at(10, 1000), at(17, 1000), at(24, 1000), at(31, 1000)];
    expect(salesMomentum([at(1, 5000), ...base], NOW).factor).toBeCloseTo(1.25);
    expect(salesMomentum([at(1, 0), ...base], NOW).factor).toBeCloseTo(0.75);
  });
  it("cancelled orders and no history", () => {
    expect(salesMomentum([at(1, 500, true), at(10, 1000), at(17, 1000), at(24, 1000), at(31, 1000)], NOW).last7).toBe(0);
    expect(salesMomentum([at(1, 500)], NOW)).toMatchObject({ ratio: null, factor: 1 });
  });
});
