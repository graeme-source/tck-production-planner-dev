import { describe, it, expect } from "vitest";
import { resolveChillMinutes } from "./meat-safety";

describe("resolveChillMinutes — measured chill only: probe, then a plausible tap, else nothing", () => {
  const MIN = 60_000;
  const bake = Date.UTC(2026, 9, 27, 11, 0);
  it("a registered probe wins: first reading at or below 8 °C after the last bake", () => {
    const readings = [{ atMs: bake + 60 * MIN, tempC: 15 }, { atMs: bake + 95 * MIN, tempC: 8 }, { atMs: bake + 100 * MIN, tempC: 7 }, { atMs: bake - 30 * MIN, tempC: 5 }];
    expect(resolveChillMinutes({ lastBakeAtMs: bake, probeReadings: readings, chilledTapAtMs: bake + 200 * MIN }))
      .toEqual({ chilledAtMs: bake + 95 * MIN, minutes: 95, source: "probe" });
  });
  it("the tap only when plausible", () => {
    expect(resolveChillMinutes({ lastBakeAtMs: bake, chilledTapAtMs: bake + 110 * MIN })).toMatchObject({ minutes: 110, source: "tap" });
    expect(resolveChillMinutes({ lastBakeAtMs: bake, chilledTapAtMs: bake + 10 * MIN })).toBeNull();
    expect(resolveChillMinutes({ lastBakeAtMs: bake, chilledTapAtMs: bake + 300 * MIN })).toBeNull();
  });
  it("no measurement → nothing (no assumed chill time is ever evidence)", () => {
    expect(resolveChillMinutes({ lastBakeAtMs: bake, probeReadings: [{ atMs: bake + 60 * MIN, tempC: 12 }] })).toBeNull();
    expect(resolveChillMinutes({ lastBakeAtMs: null, chilledTapAtMs: bake })).toBeNull();
  });
});
