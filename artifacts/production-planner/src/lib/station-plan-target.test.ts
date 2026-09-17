import { describe, it, expect } from "vitest";
import { planTargetForStation, pinsPlan } from "./station-plan-target";

describe("planTargetForStation", () => {
  it("sends dough prep and main prep to the next plan — they work a day ahead", () => {
    expect(planTargetForStation("dough_prep")).toBe("next-dough");
    expect(planTargetForStation("prep")).toBe("next-prep");
    expect(planTargetForStation("main_prep")).toBe("next-prep");
  });

  it("REGRESSION: sheeting follows TODAY, not the next dough plan", () => {
    // It borrowed the dough card's next-active lookup on the dashboard and
    // opened tomorrow's sheet (Graeme, 2026-09-17). Sheeting happens on the
    // production day.
    expect(planTargetForStation("dough_sheeting")).toBe("today");
  });

  it("keeps every other station on today's plan", () => {
    for (const key of ["mixing", "building_1", "building_2", "ovens", "wrapping", "packing", "macaroni_cheese", "fried_chicken"]) {
      expect(planTargetForStation(key)).toBe("today");
    }
  });

  it("only pins the plan for the look-ahead stations", () => {
    expect(pinsPlan("dough_prep")).toBe(true);
    expect(pinsPlan("prep")).toBe(true);
    expect(pinsPlan("dough_sheeting")).toBe(false);
    expect(pinsPlan("ovens")).toBe(false);
  });
});
