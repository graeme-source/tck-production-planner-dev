import { describe, it, expect } from "vitest";
import { checklistSwitchTargets, type StationPlanIds } from "./switch-targets";
import { STATIONS } from "../constants";

// Thu 19 Nov 2026: today's plan is 228 (19th); prep works on 229 (20th).
const plans: StationPlanIds = { today: 228, nextPrep: 229, nextDough: 229 };
const href = (from: string, planId: number, to: string, p: StationPlanIds | null = plans) =>
  checklistSwitchTargets(planId, from, p).find(t => t.key === to)?.href;

describe("checklistSwitchTargets (issue #399)", () => {
  it("offers wrapping's checklist from packing, and packing's from wrapping, on the same plan", () => {
    expect(href("packing", 228, "wrapping")).toBe("/plans/228/station/wrapping?view=checklist");
    expect(href("wrapping", 228, "packing")).toBe("/plans/228/station/packing?view=checklist");
  });

  it("never lists the station you are already on", () => {
    for (const s of STATIONS) {
      const targets = checklistSwitchTargets(1, s.key, plans);
      expect(targets.some(t => t.key === s.key)).toBe(false);
      expect(targets).toHaveLength(STATIONS.length - 1);
    }
  });

  it("every link opens straight on the checklist", () => {
    for (const t of checklistSwitchTargets(228, "ovens", plans)) {
      expect(t.href?.endsWith("view=checklist")).toBe(true);
    }
  });

  it("lists every station from a prep sub-station that isn't in the main list", () => {
    expect(checklistSwitchTargets(1, "prep_meat", plans)).toHaveLength(STATIONS.length);
  });
});

describe("REGRESSION #406: each station opens on its own day", () => {
  it("mixing → prep opens the prep list being worked today, not yesterday's finished one", () => {
    // Dave on mixing (today's plan 228) saw prep for plan 228 — the list
    // the prep team finished the day before.
    expect(href("mixing", 228, "prep")).toBe("/plans/229/station/prep?direct=1&view=checklist");
  });

  it("prep → building opens today's building list, not tomorrow's", () => {
    // Kerri-Leigh's 14:22 closing ticks landed on Friday's building list.
    expect(href("prep", 229, "building_1")).toBe("/plans/228/station/building_1?view=checklist");
  });

  it("sheeting → dough prep goes to the next dough plan", () => {
    expect(href("dough_sheeting", 228, "dough_prep")).toBe("/plans/229/station/dough_prep?direct=1&view=checklist");
  });

  it("stations on the same day keep the plan you're looking at, even an old one", () => {
    expect(href("packing", 200, "ovens")).toBe("/plans/200/station/ovens?view=checklist");
    expect(href("prep_meat", 210, "prep")).toBe("/plans/210/station/prep?direct=1&view=checklist");
  });

  it("no link while the plans are loading or when that station has no plan", () => {
    expect(href("mixing", 228, "prep", null)).toBeNull();
    expect(href("prep", 229, "ovens", { today: null, nextPrep: 229, nextDough: 229 })).toBeNull();
  });
});
