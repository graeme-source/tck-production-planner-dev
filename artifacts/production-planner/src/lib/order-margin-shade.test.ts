import { describe, expect, it } from "vitest";
import { marginShade } from "./order-margin-shade";
import { ROAS_SHADE_STEPS, shadeAtRatio } from "./ad-efficiency";

describe("marginShade", () => {
  it("is brand green on target", () => {
    expect(marginShade(40, 40)!.hex).toBe(shadeAtRatio(1).hex);
  });
  it("gets darker red the further under target, darkest for a loss", () => {
    const under = marginShade(32, 40)!;
    const loss = marginShade(-5, 40)!;
    expect(loss.step).toBe(0);
    expect(under.step).toBeGreaterThan(loss.step);
    expect(under.step).toBeLessThan(marginShade(40, 40)!.step);
  });
  it("tops out at the deepest teal well over target", () => {
    expect(marginShade(70, 40)!.step).toBe(ROAS_SHADE_STEPS);
  });
  it("has no shade without a margin or a target", () => {
    expect(marginShade(null, 40)).toBeNull();
    expect(marginShade(30, 0)).toBeNull();
    expect(marginShade(30, undefined)).toBeNull();
  });
});
