import { describe, it, expect } from "vitest";
import { maxOutToLastBuiltMinutes, minutesToChilled, planMeatWaves, resolveChillMinutes, DEFAULT_SAFETY_RULE } from "./meat-safety";

describe("the 4-hour rule", () => {
  it("max time out before the last batch is built = 240 − chill − bake", () => {
    expect(maxOutToLastBuiltMinutes(DEFAULT_SAFETY_RULE)).toBe(105);
    expect(maxOutToLastBuiltMinutes({ totalMinutes: 240, chillMinutes: 120, bakeMinutes: 13 })).toBe(107);
    expect(maxOutToLastBuiltMinutes({ totalMinutes: 240, chillMinutes: 250, bakeMinutes: 13 })).toBe(0);
  });
  it("Graeme's example: 30 min processing + 1 h build + 2 h chill = 3.5 h, fine", () => {
    // Out at 08:00, last batch built 09:30, bake 0, chill 120 → 210 min to 8 °C.
    expect(minutesToChilled(480, 570, { totalMinutes: 240, chillMinutes: 120, bakeMinutes: 0 })).toBe(210);
  });
});

describe("planMeatWaves", () => {
  const base = { cookMinutes: 25, processMinutes: 20, bufferMinutes: 5, maxSpanMinutes: 107 };

  it("a short build is one wave: out = need − processing − buffer, in = out − cook", () => {
    const p = planMeatWaves({ ...base, startMinutes: 600, finishMinutes: 660, batches: 24 });
    expect(p.impossible).toBe(false);
    expect(p.waves).toEqual([{ wave: 1, putInMinutes: 550, outMinutes: 575, neededFromMinutes: 600, neededToMinutes: 660, batches: 24 }]);
  });

  it("a long build splits into the fewest balanced waves inside the rule", () => {
    // Builds 10:00 → 13:00 (180 min, 72 batches). One cook covers 107 − 25 =
    // 82 min of building → 3 waves of 60 min / 24 batches each.
    const p = planMeatWaves({ ...base, startMinutes: 600, finishMinutes: 780, batches: 72 });
    expect(p.waves.map(w => [w.putInMinutes, w.outMinutes, w.neededFromMinutes, w.neededToMinutes, w.batches])).toEqual([
      [550, 575, 600, 660, 24],
      [610, 635, 660, 720, 24],
      [670, 695, 720, 780, 24],
    ]);
    // Every wave is inside the rule: out → its last batch built ≤ maxSpan.
    for (const w of p.waves) expect(w.neededToMinutes - w.outMinutes).toBeLessThanOrEqual(107);
  });

  it("just over the limit: two even waves, never a one-batch straggler", () => {
    const p = planMeatWaves({ ...base, startMinutes: 600, finishMinutes: 690, batches: 36 });
    expect(p.waves.map(w => w.batches)).toEqual([18, 18]);
  });

  it("impossible when processing + buffer alone use up the limit", () => {
    const p = planMeatWaves({ ...base, processMinutes: 100, bufferMinutes: 10, startMinutes: 600, finishMinutes: 800, batches: 40 });
    expect(p.impossible).toBe(true);
  });
});

describe("resolveChillMinutes — probe, then a plausible tap, then the default", () => {
  const MIN = 60_000;
  const bake = Date.UTC(2026, 9, 27, 11, 0);
  it("a registered probe wins: first reading at or below 8 °C after the last bake", () => {
    const readings = [{ atMs: bake + 60 * MIN, tempC: 15 }, { atMs: bake + 95 * MIN, tempC: 8 }, { atMs: bake + 100 * MIN, tempC: 7 }, { atMs: bake - 30 * MIN, tempC: 5 }];
    expect(resolveChillMinutes({ lastBakeAtMs: bake, probeReadings: readings, chilledTapAtMs: bake + 200 * MIN, defaultMinutes: 120 })).toEqual({ minutes: 95, source: "probe" });
  });
  it("the tap only when plausible", () => {
    expect(resolveChillMinutes({ lastBakeAtMs: bake, chilledTapAtMs: bake + 110 * MIN, defaultMinutes: 120 })).toEqual({ minutes: 110, source: "tap" });
    expect(resolveChillMinutes({ lastBakeAtMs: bake, chilledTapAtMs: bake + 10 * MIN, defaultMinutes: 120 })).toEqual({ minutes: 120, source: "default" });
    expect(resolveChillMinutes({ lastBakeAtMs: bake, chilledTapAtMs: bake + 300 * MIN, defaultMinutes: 120 })).toEqual({ minutes: 120, source: "default" });
  });
  it("a probe that never reached 8 °C falls back", () => {
    expect(resolveChillMinutes({ lastBakeAtMs: bake, probeReadings: [{ atMs: bake + 60 * MIN, tempC: 12 }], defaultMinutes: 120 }).source).toBe("default");
  });
});
