import { describe, expect, it } from "vitest";
import { curriculumIsExternallyManaged } from "./lean-library-guard";

// Regression test for the Aug 2026 "lean topic changes daily" incident: the
// boot seeder re-applied the starter curriculum on top of an installed
// library on every boot (retitling week 3, deactivating weeks 4–5,
// re-inserting retired principles). The seeder must stand down whenever an
// installed library owns the lean tables.
describe("curriculumIsExternallyManaged", () => {
  it("is false on a fresh install (no marker, nothing archived)", () => {
    expect(curriculumIsExternallyManaged(null, 0)).toBe(false);
    expect(curriculumIsExternallyManaged(undefined, 0)).toBe(false);
    expect(curriculumIsExternallyManaged("", 0)).toBe(false);
  });

  it("is true once a library version marker is stamped", () => {
    expect(curriculumIsExternallyManaged("v2-seeing-waste-9wk", 0)).toBe(true);
  });

  it("is true when archived principles exist, even without the marker", () => {
    // The Aug 2026 rebuild predates the marker: it parked the old
    // curriculum at week_position >= 1000 but stamped nothing. Live must
    // be recognised as managed from that signature alone.
    expect(curriculumIsExternallyManaged(null, 42)).toBe(true);
  });

  it("is true when both signals are present", () => {
    expect(curriculumIsExternallyManaged("v2-seeing-waste-9wk", 42)).toBe(true);
  });
});
