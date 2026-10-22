import { describe, expect, it } from "vitest";
import { resolveChecklistStation } from "./checklist-stations";

describe("resolveChecklistStation", () => {
  // Fix queue #171: Dough Prep and Dough Sheeting are separate jobs and must
  // each have their own checklist.
  it("gives Dough Prep and Dough Sheeting different checklists", () => {
    expect(resolveChecklistStation("dough_prep")).toBe("dough_prep");
    expect(resolveChecklistStation("dough_sheeting")).toBe("dough_sheeting");
    expect(resolveChecklistStation("dough_prep")).not.toBe(resolveChecklistStation("dough_sheeting"));
  });

  it("still shares Building 2 with Building 1 and every prep section with prep", () => {
    expect(resolveChecklistStation("building_2")).toBe("building_1");
    expect(resolveChecklistStation("building_1")).toBe("building_1");
    for (const s of ["main_prep", "prep_bases", "prep_meat", "prep"]) {
      expect(resolveChecklistStation(s)).toBe("prep");
    }
  });

  it("leaves other stations on their own checklist", () => {
    expect(resolveChecklistStation("mixing")).toBe("mixing");
    expect(resolveChecklistStation("ovens")).toBe("ovens");
  });
});
