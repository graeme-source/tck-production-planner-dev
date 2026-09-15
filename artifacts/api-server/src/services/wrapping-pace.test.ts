import { describe, it, expect } from "vitest";
import { paceFromSubs, WRAPPING_IDLE_THRESHOLD_MS } from "./wrapping-pace";

const MIN = 60_000;

describe("paceFromSubs", () => {
  it("fewer than two submissions gives packs but no rate", () => {
    expect(paceFromSubs([{ ts: 0, packs: 24 }])).toMatchObject({ packs: 24, packsPerHour: null, activeMinutes: null });
  });

  it("steady work: 24-pack stacks every 8 minutes = 216/hr over the window", () => {
    const subs = Array.from({ length: 6 }, (_, i) => ({ ts: i * 8 * MIN, packs: 24 }));
    const r = paceFromSubs(subs);
    // 144 packs over 40 active minutes.
    expect(r.packs).toBe(144);
    expect(r.activeMinutes).toBe(40);
    expect(r.packsPerHour).toBe(216);
    expect(r.idleBreaks).toBe(0);
  });

  it("a long gap pauses the clock and is excluded entirely", () => {
    const subs = [
      { ts: 0, packs: 24 },
      { ts: 10 * MIN, packs: 24 },
      { ts: 70 * MIN, packs: 24 },   // 60-min gap → idle
      { ts: 80 * MIN, packs: 24 },
    ];
    const r = paceFromSubs(subs);
    expect(r.idleBreaks).toBe(1);
    expect(r.idleMinutes).toBe(60);
    expect(r.activeMinutes).toBe(20);
    expect(r.packsPerHour).toBe(288); // 96 packs / 20 active min
  });

  it("a gap exactly at the threshold does NOT count as idle", () => {
    const subs = [
      { ts: 0, packs: 10 },
      { ts: WRAPPING_IDLE_THRESHOLD_MS, packs: 10 },
    ];
    expect(paceFromSubs(subs).idleBreaks).toBe(0);
  });

  it("unsorted input is handled", () => {
    const r = paceFromSubs([{ ts: 10 * MIN, packs: 5 }, { ts: 0, packs: 5 }]);
    expect(r.windowMinutes).toBe(10);
  });
});
