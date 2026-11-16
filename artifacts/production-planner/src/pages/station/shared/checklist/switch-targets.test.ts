import { describe, it, expect } from "vitest";
import { checklistSwitchTargets } from "./switch-targets";
import { STATIONS } from "../constants";

describe("checklistSwitchTargets (issue #399)", () => {
  it("offers wrapping's checklist from packing, and packing's from wrapping", () => {
    const fromPacking = checklistSwitchTargets(135, "packing");
    expect(fromPacking.find(t => t.key === "wrapping")?.href).toBe("/plans/135/station/wrapping?view=checklist");
    const fromWrapping = checklistSwitchTargets(135, "wrapping");
    expect(fromWrapping.find(t => t.key === "packing")?.href).toBe("/plans/135/station/packing?view=checklist");
  });

  it("never lists the station you are already on", () => {
    for (const s of STATIONS) {
      const targets = checklistSwitchTargets(1, s.key);
      expect(targets.some(t => t.key === s.key)).toBe(false);
      expect(targets).toHaveLength(STATIONS.length - 1);
    }
  });

  it("every link opens straight on the checklist for the same plan", () => {
    for (const t of checklistSwitchTargets(42, "ovens")) {
      expect(t.href.startsWith("/plans/42/station/")).toBe(true);
      expect(t.href.endsWith("?view=checklist")).toBe(true);
    }
  });

  it("lists every station from a prep sub-station that isn't in the main list", () => {
    expect(checklistSwitchTargets(1, "prep_meat")).toHaveLength(STATIONS.length);
  });
});
