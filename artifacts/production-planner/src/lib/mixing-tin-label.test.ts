import { describe, it, expect } from "vitest";
import { mixingTinLabel } from "./mixing-tin-label";

describe("mixing tin label (fix queue #373)", () => {
  it("names the next tin while tins remain", () => {
    expect(mixingTinLabel(0, 2)).toEqual({
      allDone: false,
      heading: "Filling Mix — Tin 1 of 2",
      completeLabel: "Complete Tin 1",
    });
    expect(mixingTinLabel(1, 2).completeLabel).toBe("Complete Tin 2");
  });

  it("never shows Tin 3 of 2 once every tin is done", () => {
    expect(mixingTinLabel(2, 2)).toEqual({
      allDone: true,
      heading: "All 2 tins mixed",
      completeLabel: null,
    });
  });

  it("uses the singular for one tin", () => {
    expect(mixingTinLabel(1, 1).heading).toBe("All 1 tin mixed");
  });

  it("treats more than the target as all done", () => {
    expect(mixingTinLabel(3, 2).allDone).toBe(true);
  });
});
