import { describe, expect, it } from "vitest";
import { allPacksIn, blastTrayLabel, chillNotStartedHint, type BlastTrayState } from "./ovens-blast-tray";

const state = (o: Partial<BlastTrayState>): BlastTrayState => ({
  addCount: 0, ovensCount: 0, builtCount: 0, target: 40, buildingFinished: false, ...o,
});

describe("blastTrayLabel (Fix queue #321)", () => {
  it("offers a full tray or the final few packs", () => {
    expect(blastTrayLabel(state({ addCount: 10, builtCount: 20 }))).toBe("Blast Chiller Tray (+10 packs)");
    expect(blastTrayLabel(state({ addCount: 3, builtCount: 43, ovensCount: 40 }))).toBe("Add Final 3 Packs");
    expect(blastTrayLabel(state({ addCount: 1 }))).toBe("Add Final 1 Pack");
  });

  // Regression: builders had sent everything (plus 3 extra packs) and the
  // button still said "Waiting for building".
  it("says All packs in once the plan's packs are in, extras or not", () => {
    expect(blastTrayLabel(state({ ovensCount: 40, builtCount: 43 }))).toBe("All packs in");
    expect(blastTrayLabel(state({ ovensCount: 40, builtCount: 40 }))).toBe("All packs in");
  });

  it("says All packs in on a short build once building is finished and all taken in", () => {
    expect(blastTrayLabel(state({ ovensCount: 30, builtCount: 30, buildingFinished: true }))).toBe("All packs in");
  });

  it("still says Waiting for building while builders are behind", () => {
    expect(blastTrayLabel(state({ ovensCount: 20, builtCount: 20 }))).toBe("Waiting for building");
    expect(allPacksIn(state({ ovensCount: 20, builtCount: 20 }))).toBe(false);
  });
});

describe("chillNotStartedHint", () => {
  it("points mac cheese at the sauce temperature, not the final batch", () => {
    expect(chillNotStartedHint(true)).toMatch(/after melting cheese/);
    expect(chillNotStartedHint(true)).not.toMatch(/final batch/);
    expect(chillNotStartedHint(false)).toMatch(/final batch/);
  });
});
