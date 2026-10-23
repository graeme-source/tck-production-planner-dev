// Regression: the Mixing padlock checked a station named "building", which
// never has records — builds are recorded under building_1 / building_2 — so
// rows never locked once building had started (Graeme approved, 23 Oct 2026).
import { describe, expect, it } from "vitest";
import { buildingBatchesDone, hasBuildingStarted, isBuildingStation } from "./building-stations";

describe("isBuildingStation", () => {
  it("recognises every building table, including future ones", () => {
    for (const s of ["building_1", "building_2", "building_3", "building_12", "building"]) {
      expect(isBuildingStation(s)).toBe(true);
    }
  });

  it("rejects other stations and look-alikes", () => {
    for (const s of ["mixing", "dough_sheeting", "ovens", "wrapping", "rebuilding", "building_", "building_x", "building_1b"]) {
      expect(isBuildingStation(s)).toBe(false);
    }
  });
});

describe("hasBuildingStarted — the Mixing padlock", () => {
  it("is true once building_1 or building_2 has a batch (the real data shape)", () => {
    expect(hasBuildingStarted({ stationCompletions: { mixing: 4, building_1: 1 } })).toBe(true);
    expect(hasBuildingStarted({ stationCompletions: { mixing: 4, building_2: 2 } })).toBe(true);
    expect(hasBuildingStarted({ stationCompletions: { mixing: 4, building_3: 1 } })).toBe(true);
  });

  it("is false before any build, whatever else is done", () => {
    expect(hasBuildingStarted({ stationCompletions: { mixing: 6, dough_sheeting: 6 } })).toBe(false);
    expect(hasBuildingStarted({ stationCompletions: { building_1: 0, building_2: 0 } })).toBe(false);
    expect(hasBuildingStarted({ stationCompletions: null })).toBe(false);
    expect(hasBuildingStarted({})).toBe(false);
  });

  it("adds up every building table", () => {
    expect(buildingBatchesDone({ building_1: 3, building_2: 2, mixing: 9, ovens: 4 })).toBe(5);
  });
});
