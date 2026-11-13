import { describe, it, expect } from "vitest";
import { paceLevel, amberFrom, resolveKpis, kpiProblem, DEFAULT_PRODUCTION_KPIS } from "./production-kpis";

describe("production KPIs", () => {
  const packing = { standard: 55, stretch: 60 };
  it("keeps the packing screen's old bands at 55 / 60 (amber from 49.5)", () => {
    expect(paceLevel(84.6, packing)).toBe("stretch");
    expect(paceLevel(60, packing)).toBe("stretch");
    expect(paceLevel(57, packing)).toBe("standard");
    expect(paceLevel(50, packing)).toBe("close");
    expect(amberFrom(packing)).toBe(49.5);
    expect(paceLevel(49, packing)).toBe("below");
  });
  it("moves every band when the standard is raised", () => {
    const raised = { standard: 70, stretch: 85 };
    expect(paceLevel(65, raised)).toBe("close");
    expect(paceLevel(60, raised)).toBe("below");
    expect(paceLevel(84.6, raised)).toBe("standard");
  });
  it("no stretch: nothing is above standard", () => {
    expect(paceLevel(500, { standard: 55, stretch: null })).toBe("standard");
  });
  it("falls back to the old figures until the stored ones load", () => {
    expect(resolveKpis(undefined)).toEqual(DEFAULT_PRODUCTION_KPIS);
    expect(resolveKpis({ packing: { standard: 70, stretch: 80 } }).packing.standard).toBe(70);
  });
  it("refuses a stretch at or under the standard", () => {
    expect(kpiProblem(55, 60)).toBeNull();
    expect(kpiProblem(55, null)).toBeNull();
    expect(kpiProblem(55, 55)).toMatch(/above the standard/);
    expect(kpiProblem(0, 60)).toMatch(/above 0/);
  });
});
