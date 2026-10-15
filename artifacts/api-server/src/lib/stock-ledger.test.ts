import { describe, expect, it } from "vitest";
import {
  chooseOrderStock,
  countVariances,
  expectedAt,
  isSystemStockNote,
  medianAbsGap,
  mergeCounts,
  varianceFlags,
  type IngredientLedger,
} from "./stock-ledger";
import { isTinOutstanding } from "./stock-usage-rules";

const H = 3_600_000;
const day = (d: number, h = 0) => Date.UTC(2026, 9, d, h);

function ledger(partial: Partial<IngredientLedger>): IngredientLedger {
  return { counts: [], receipts: [], usage: [], coverage: "tracked", ...partial };
}

describe("isSystemStockNote — counts vs goods-in rows", () => {
  it("treats goods-in, undo and transfer rows as movements", () => {
    expect(isSystemStockNote("Delivery from PO #812")).toBe(true);
    expect(isSystemStockNote("Delivery from PO #9 (edit)")).toBe(true);
    expect(isSystemStockNote("Delivery from PO #9 (was 4 bottles; converted to litres 2026-09-24)")).toBe(true);
    expect(isSystemStockNote("Undo delivery PO #77")).toBe(true);
    expect(isSystemStockNote("Transfer out to production_freezer (−3)")).toBe(true);
    expect(isSystemStockNote("Transfer in from prep_fridge (+3)")).toBe(true);
  });
  it("treats every other row as a person's count", () => {
    expect(isSystemStockNote(null)).toBe(false);
    expect(isSystemStockNote("")).toBe(false);
    expect(isSystemStockNote("Counted after spillage")).toBe(false);
    expect(isSystemStockNote("Manual stock-control entry")).toBe(false);
  });
});

describe("expectedAt", () => {
  const l = ledger({
    counts: [{ at: day(12, 14), qty: 10 }],
    receipts: [{ at: day(13, 7), qty: 25 }],
    usage: [
      { at: day(12, 13), qty: 4, source: "prep", planId: 1 },   // before the count: inside it
      { at: day(13, 10), qty: 6, source: "prep", planId: 2 },
      { at: day(13, 12), qty: 2.5, source: "build", planId: 2 },
      { at: day(14, 9), qty: 1, source: "subRecipe", planId: 3 },
    ],
  });

  it("is last count + receipts since − usage since", () => {
    const e = expectedAt(l, day(14, 12))!;
    expect(e.basedOn.qty).toBe(10);
    expect(e.receipts).toBe(25);
    expect(e.usage).toBe(9.5);
    expect(e.expected).toBe(25.5);
    expect(e.usageBySource).toEqual({ prep: 6, build: 2.5, subRecipe: 1 });
    expect(e.usageByPlan).toEqual({ 2: 8.5, 3: 1 });
  });

  it("is null before the first count — there is no starting point", () => {
    expect(expectedAt(l, day(12, 9))).toBeNull();
    expect(expectedAt(ledger({ receipts: [{ at: day(1), qty: 732 }] }), day(14))).toBeNull();
  });

  it("restarts from each new count", () => {
    const withRecount = { ...l, counts: [...l.counts, { at: day(14, 8), qty: 18 }] };
    const e = expectedAt(withRecount, day(14, 12))!;
    expect(e.basedOn.qty).toBe(18);
    expect(e.expected).toBe(17);
  });
});

describe("mergeCounts", () => {
  it("collapses the two copies of one prep-station count", () => {
    const merged = mergeCounts([
      { at: day(12, 14), qty: 5 },
      { at: day(12, 14) + 3_000, qty: 5 },
      { at: day(13, 14), qty: 4 },
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("countVariances", () => {
  it("compares each count with what was expected just before it", () => {
    const l = ledger({
      counts: [{ at: day(12, 14), qty: 10 }, { at: day(13, 14), qty: 6 }],
      receipts: [{ at: day(13, 7), qty: 5 }],
      usage: [{ at: day(13, 10), qty: 8, source: "prep", planId: 1 }],
    });
    const [v] = countVariances(l);
    expect(v.expected).toBe(7);
    expect(v.counted).toBe(6);
    expect(v.diff).toBe(-1);
    expect(v.pct).toBeCloseTo(-1 / 7);
    // Gap is measured against the bigger of expected (7) and usage (8).
    expect(v.gap).toBeCloseTo(-1 / 8);
  });

  it("keeps the gap meaningful near zero stock", () => {
    const l = ledger({
      counts: [{ at: day(12, 14), qty: 1 }, { at: day(13, 14), qty: 0 }],
      receipts: [{ at: day(13, 7), qty: 12 }],
      usage: [{ at: day(13, 10), qty: 12.8, source: "prep", planId: 1 }],
    });
    const [v] = countVariances(l);
    expect(v.pct).toBeCloseTo(-1); // −100 % of a 0.2 kg expectation
    expect(v.gap).toBeCloseTo(-0.2 / 12.8);
  });
});

describe("varianceFlags", () => {
  const mk = (diffs: number[]) => {
    const counts = [{ at: day(1), qty: 10 }];
    const usage = [];
    let level = 10;
    for (let i = 0; i < diffs.length; i++) {
      usage.push({ at: day(i + 2, 8), qty: 5, source: "prep" as const, planId: i });
      level = level - 5 + 5 + diffs[i];
      counts.push({ at: day(i + 2, 14), qty: level });
    }
    const receipts = diffs.map((_, i) => ({ at: day(i + 2, 6), qty: 5 }));
    return countVariances(ledger({ counts, receipts, usage }));
  };

  it("flags counts that keep coming in short", () => {
    const flags = varianceFlags(mk([-2, -2, -1.5, -3]));
    expect(flags.map(f => f.kind)).toEqual(["repeated-shortfall"]);
  });
  it("flags counts that keep coming in over", () => {
    expect(varianceFlags(mk([2, 2, 2])).map(f => f.kind)).toEqual(["repeated-surplus"]);
  });
  it("flags a single big gap as a possible miscount", () => {
    expect(varianceFlags(mk([0, 0, -6])).map(f => f.kind)).toEqual(["big-gap"]);
  });
  it("is quiet when counts match", () => {
    expect(varianceFlags(mk([0, 0.1, -0.1, 0]))).toEqual([]);
  });
  it("flags an expected figure below zero", () => {
    expect(varianceFlags([], -3).map(f => f.kind)).toEqual(["goes-negative"]);
  });
  it("reports typical accuracy as the median gap", () => {
    expect(medianAbsGap(mk([-1, 0, 2]))).toBeCloseTo(1 / 10);
  });
});

describe("chooseOrderStock", () => {
  const exp = expectedAt(ledger({
    counts: [{ at: day(12, 14), qty: 10 }],
    receipts: [{ at: day(13, 7), qty: 25 }],
    usage: [
      { at: day(13, 10), qty: 6, source: "prep", planId: 2 },
      { at: day(14, 10), qty: 4, source: "prep", planId: 9 },
    ],
  }), day(14, 12));

  const base = {
    snapshotStock: 35, stockCheckEnabled: true, lastCountDate: "2026-10-12", today: "2026-10-14",
    expected: exp, coverage: "tracked" as const, selectedPlanId: 9,
  };

  it("uses today's count as before", () => {
    expect(chooseOrderStock({ ...base, lastCountDate: "2026-10-14" }))
      .toEqual({ basis: "count", stockOnHand: 35, outstandingPrepFromNow: false });
  });

  it("uses the expected figure without a count today, adding back the ordered plan's own usage", () => {
    // expected = 10 + 25 − 6 − 4 = 25; plan 9's 4 is already in its requirement.
    expect(chooseOrderStock(base)).toEqual({ basis: "expected", stockOnHand: 29, outstandingPrepFromNow: true });
  });

  it("never orders against a negative expected figure", () => {
    const neg = { ...exp!, expected: -8, usageByPlan: {} };
    expect(chooseOrderStock({ ...base, expected: neg }).stockOnHand).toBe(0);
  });

  it("keeps the old behaviour when usage isn't tracked or there's no count", () => {
    expect(chooseOrderStock({ ...base, coverage: "untracked" }).basis).toBe("count");
    expect(chooseOrderStock({ ...base, expected: null, stockCheckEnabled: false }))
      .toEqual({ basis: "not-counted", stockOnHand: 35, outstandingPrepFromNow: false });
  });
});

describe("Orders: expected stock and still-to-prep agree", () => {
  // A count, three 1 kg tins on today's (not-ordered-for) plan: one ticked
  // before the count, one after it, one not yet. Starting from the count
  // (outstanding from the count time) or from the expected figure
  // (outstanding from now) must land on the same effective stock.
  const countAt = day(14, 9);
  const now = day(14, 15);
  const tins = [day(14, 8), day(14, 11), null];
  const count = 10;

  it("gives the same effective stock either way", () => {
    const outstandingFromCount = tins.filter(t => isTinOutstanding(t, countAt)).length;
    const l = ledger({
      counts: [{ at: countAt, qty: count }],
      usage: tins.filter((t): t is number => t != null).map(t => ({ at: t, qty: 1, source: "prep" as const, planId: 5 })),
    });
    const e = expectedAt(l, now)!;
    const outstandingFromNow = tins.filter(t => isTinOutstanding(t, now)).length;
    expect(count - outstandingFromCount).toBe(8);
    expect(e.expected - outstandingFromNow).toBe(8);
  });
});
