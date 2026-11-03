import { describe, expect, it } from "vitest";
import { createStageTimer } from "./stage-timer";

describe("createStageTimer", () => {
  it("times each stage from the previous mark and totals them in one line", () => {
    let t = 1000;
    const timer = createStageTimer("[orders/calculate] plan 7", () => t);
    t += 120.4; timer.mark("recipes");
    t += 45000; timer.mark("ledger");
    t += 3; timer.mark("lines");
    expect(timer.stages()).toEqual([["recipes", 120], ["ledger", 45000], ["lines", 3]]);
    expect(timer.line()).toBe("[orders/calculate] plan 7 recipes 120ms ledger 45000ms lines 3ms total 45123ms");
    expect(timer.line("12 suppliers")).toBe("[orders/calculate] plan 7 recipes 120ms ledger 45000ms lines 3ms total 45123ms 12 suppliers");
  });
});
