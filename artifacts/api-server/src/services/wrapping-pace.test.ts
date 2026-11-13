import { describe, it, expect } from "vitest";
import { paceFromSubs } from "./wrapping-pace";

const MIN = 60_000;
// 13 Nov 2026 in London (GMT): minutes since midnight → epoch ms.
const at = (h: number, m = 0) => Date.UTC(2026, 10, 13, h, m);

describe("paceFromSubs — first wrap to last wrap, minus breaks (13 Nov 2026)", () => {
  it("fewer than two submissions gives packs but no rate", () => {
    expect(paceFromSubs([{ ts: at(11), packs: 24 }])).toMatchObject({ packs: 24, packsPerHour: null, activeMinutes: null });
  });

  it("no gap is excluded any more: a 25-minute stop for a delivery still counts", () => {
    const subs = [
      { ts: at(13, 0), packs: 24 },
      { ts: at(13, 10), packs: 24 },
      { ts: at(13, 35), packs: 24 }, // 25-min stop — used to be excluded
      { ts: at(13, 40), packs: 24 },
    ];
    const r = paceFromSubs(subs);
    expect(r.windowMinutes).toBe(40);
    expect(r.idleMinutes).toBe(0);
    expect(r.activeMinutes).toBe(40);
    expect(r.packsPerHour).toBe(144);
  });

  it("lunch comes off like the line: a 50-minute stop → 35 + 7 allowance", () => {
    const subs = [
      { ts: at(11, 0), packs: 120 },
      { ts: at(12, 0), packs: 120 },
      { ts: at(12, 50), packs: 120 }, // lunch stop
      { ts: at(15, 0), packs: 120 },
    ];
    const r = paceFromSubs(subs);
    expect(r.windowMinutes).toBe(240);
    expect(r.idleBreaks).toBe(1);
    expect(r.idleMinutes).toBe(42);
    expect(r.activeMinutes).toBe(198);
    expect(r.packsPerHour).toBe(Math.round(480 / (198 / 60)));
  });

  it("a typical day reads about 114/hr, not ~250", () => {
    // 495 packs, 11:00 → 16:00 with a lunch stop.
    const subs = [
      { ts: at(11, 0), packs: 100 }, { ts: at(12, 10), packs: 100 },
      { ts: at(13, 0), packs: 100 }, { ts: at(14, 30), packs: 100 }, { ts: at(16, 0), packs: 95 },
    ];
    const r = paceFromSubs(subs);
    expect(r.packsPerHour).toBeGreaterThan(100);
    expect(r.packsPerHour).toBeLessThan(130);
  });

  it("unsorted input is handled", () => {
    const r = paceFromSubs([{ ts: at(11, 10), packs: 5 }, { ts: at(11), packs: 5 }]);
    expect(r.windowMinutes).toBe(10);
  });
});
