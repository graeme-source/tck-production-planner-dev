import { describe, it, expect } from "vitest";
import { trainingSectionsFor, stationTrainingPath, splitStations } from "./training-sections";

describe("trainingSectionsFor", () => {
  it("shows staff only the station matrices", () => {
    expect(trainingSectionsFor("viewer")).toEqual({ stationMatrices: true, storedMatrices: false, enforceSwitch: false });
  });
  it("shows managers the stored matrices too, but not the enforcement switch", () => {
    expect(trainingSectionsFor("manager")).toEqual({ stationMatrices: true, storedMatrices: true, enforceSwitch: false });
  });
  it("shows admins everything", () => {
    expect(trainingSectionsFor("admin")).toEqual({ stationMatrices: true, storedMatrices: true, enforceSwitch: true });
  });
  it("treats an unknown or missing role as staff", () => {
    expect(trainingSectionsFor(undefined).storedMatrices).toBe(false);
    expect(trainingSectionsFor(null).enforceSwitch).toBe(false);
    expect(trainingSectionsFor("owner").storedMatrices).toBe(false);
  });
});

describe("stationTrainingPath", () => {
  it("puts a station's matrix under /training/stations", () => {
    expect(stationTrainingPath("mixing")).toBe("/training/stations/mixing");
  });
  it("falls back to the Training page with no station", () => {
    expect(stationTrainingPath()).toBe("/training");
    expect(stationTrainingPath("")).toBe("/training");
    expect(stationTrainingPath("  ")).toBe("/training");
  });
  it("encodes anything odd rather than breaking the URL", () => {
    expect(stationTrainingPath("a/b")).toBe("/training/stations/a%2Fb");
  });
});

describe("splitStations", () => {
  const s = (station: string) => ({ station, sopCount: 1 });
  it("keeps the known station order and lists the rest as having no SOPs", () => {
    const r = splitStations(["dough", "mixing", "ovens"], [s("ovens"), s("dough")]);
    expect(r.withSops.map(x => x.station)).toEqual(["dough", "ovens"]);
    expect(r.without).toEqual(["mixing"]);
  });
  it("appends stations only the API knows about", () => {
    const r = splitStations(["dough"], [s("prep_meat"), s("dough")]);
    expect(r.withSops.map(x => x.station)).toEqual(["dough", "prep_meat"]);
    expect(r.without).toEqual([]);
  });
  it("copes with nothing loaded yet", () => {
    expect(splitStations(["dough"], [])).toEqual({ withSops: [], without: ["dough"] });
  });
});
