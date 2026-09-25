import { describe, it, expect } from "vitest";
import {
  applyRejectTap,
  liveCounter,
  rejectCounterChanges,
  sumQualityRejects,
  type RejectCounts,
} from "./quality-rejects";

const zero: RejectCounts = { wonlyCount: 0, wonlyTotal: 0, dogBinCount: 0 };

describe("quality reject taps", () => {
  it("a dog bin never increases wonky (or any stock) counters", () => {
    const changes = rejectCounterChanges("dog_bin", 1);
    expect(changes).toEqual({ dogBinCount: 1 });
    // Only the dog bin counter moves: no wonky rack, no wonky total, and no
    // fridge/freezer quantity is even in the vocabulary of a tap.
    expect(Object.keys(changes)).not.toContain("wonlyCount");
    expect(Object.keys(changes)).not.toContain("wonlyTotal");
    expect(Object.keys(changes)).not.toContain("freezerQty");
    expect(Object.keys(changes)).not.toContain("fridgeQty");

    let counts = { ...zero, wonlyCount: 4, wonlyTotal: 6 };
    for (let i = 0; i < 5; i++) {
      const r = applyRejectTap(counts, "dog_bin", 1);
      if (!r.ok) throw new Error("unexpected");
      counts = r.counts;
    }
    expect(counts).toEqual({ wonlyCount: 4, wonlyTotal: 6, dogBinCount: 5 });
  });

  it("removing a dog bin restores the count", () => {
    const added = applyRejectTap(zero, "dog_bin", 1);
    if (!added.ok) throw new Error("unexpected");
    expect(added.counts.dogBinCount).toBe(1);
    const removed = applyRejectTap(added.counts, "dog_bin", -1);
    expect(removed).toEqual({ ok: true, counts: zero });
  });

  it("can't take a dog bin off below zero", () => {
    expect(applyRejectTap(zero, "dog_bin", -1)).toEqual({ ok: false, reason: "already_zero" });
    // A wonky on the rack doesn't make a dog bin removable.
    expect(applyRejectTap({ ...zero, wonlyCount: 3, wonlyTotal: 3 }, "dog_bin", -1).ok).toBe(false);
  });

  it("wonky behaviour is unchanged: rack count and day total move together", () => {
    expect(rejectCounterChanges("wonky", 1)).toEqual({ wonlyCount: 1, wonlyTotal: 1 });
    expect(rejectCounterChanges("wonky", -1)).toEqual({ wonlyCount: -1, wonlyTotal: -1 });
    const r = applyRejectTap({ ...zero, dogBinCount: 2 }, "wonky", 1);
    expect(r).toEqual({ ok: true, counts: { wonlyCount: 1, wonlyTotal: 1, dogBinCount: 2 } });
  });

  it("wonky removal is guarded on the live rack count, not the day total", () => {
    // After a transfer to the freezer the rack is 0 but the total stays.
    const afterTransfer = { ...zero, wonlyCount: 0, wonlyTotal: 5 };
    expect(applyRejectTap(afterTransfer, "wonky", -1)).toEqual({ ok: false, reason: "already_zero" });
    expect(liveCounter("wonky")).toBe("wonlyCount");
    expect(liveCounter("dog_bin")).toBe("dogBinCount");
  });

  it("floors at zero like the SQL GREATEST guard", () => {
    // A total that's somehow behind the rack count can't go negative.
    const r = applyRejectTap({ wonlyCount: 1, wonlyTotal: 0, dogBinCount: 0 }, "wonky", -1);
    expect(r).toEqual({ ok: true, counts: zero });
  });
});

describe("sumQualityRejects (meeting numbers)", () => {
  it("reports wonky and dog bin as separate figures", () => {
    expect(sumQualityRejects([
      { wonlyTotal: 4, dogBinCount: 1 },
      { wonlyTotal: 2, dogBinCount: 1 },
      { wonlyTotal: null, dogBinCount: null },
    ])).toEqual({ wonky: 6, dogBin: 2 });
  });

  it("reads a row without a dog bin field as zero dog bins", () => {
    expect(sumQualityRejects([{ wonlyTotal: 3 }])).toEqual({ wonky: 3, dogBin: 0 });
  });
});
