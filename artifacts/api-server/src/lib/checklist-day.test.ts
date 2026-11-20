import { describe, it, expect } from "vitest";
import { checklistPlanKind } from "./checklist-day";

describe("checklistPlanKind (Graeme, 20 Nov 2026)", () => {
  it("REGRESSION: prep's checklist is the plan it's prepping for, from every path", () => {
    // From Production Plans, Prep opened today's plan and showed yesterday's
    // finished prep list; from the dashboard it showed today's.
    for (const s of ["prep", "main_prep", "prep_bases", "prep_meat"]) expect(checklistPlanKind(s)).toBe("next-prep");
    expect(checklistPlanKind("dough_prep")).toBe("next-dough");
  });
  it("every other station's checklist is today's plan — sheeting included", () => {
    for (const s of ["dough_sheeting", "mixing", "building_1", "building_2", "ovens", "wrapping", "packing", "macaroni_cheese", "fried_chicken"]) {
      expect(checklistPlanKind(s)).toBe("today");
    }
  });
});
