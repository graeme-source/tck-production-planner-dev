// Fix queue #376: the Orders page reads a ledger trimmed to its two latest
// counts. Everything it reads must come out exactly as from the full ledger.
import { describe, expect, it } from "vitest";
import {
  countVariances,
  expectedAt,
  latestTwoCounts,
  ledgerNeedsEventsAfter,
  trimLedgerToLatestCounts,
  type IngredientLedger,
} from "./stock-ledger";
import { orderLineStock } from "./order-line-stock";

const day = (d: number, h = 0, m = 0) => Date.UTC(2026, 9, d, h, m);

function ledger(partial: Partial<IngredientLedger>): IngredientLedger {
  return { counts: [], receipts: [], usage: [], coverage: "tracked", ...partial };
}

// A month of history: counts (one recorded twice by the prep station),
// deliveries, prep/mixing/build usage across several plans, waste.
const full = ledger({
  counts: [
    { at: day(1, 9), qty: 40 },
    { at: day(8, 9), qty: 22 },
    { at: day(15, 9), qty: 31 },
    { at: day(20, 15), qty: 12.5 },
    { at: day(20, 15, 1), qty: 12 }, // the same count again, 1 min later
    { at: day(21, 9), qty: 9.75 },
  ],
  receipts: [
    { at: day(5, 7), qty: 20 },
    { at: day(16, 7), qty: 10 },
    { at: day(21, 7), qty: 5 },
    { at: day(21, 12), qty: 12 },
  ],
  usage: [
    { at: day(3, 10), qty: 6, source: "prep", planId: 1 },
    { at: day(18, 10), qty: 4, source: "prep", planId: 7 },
    { at: day(20, 16), qty: 1.5, source: "mixing", planId: 8 },
    { at: day(21, 9), qty: 2, source: "prep", planId: 8 }, // at the count: inside it
    { at: day(21, 10), qty: 3.25, source: "build", planId: 9 },
    { at: day(21, 11), qty: 0.4, source: "waste", planId: null },
  ],
});

describe("ledger windowed to its two latest counts (Orders page, #376)", () => {
  it("keeps the two latest merged counts and the events after the earlier one", () => {
    expect(latestTwoCounts(full.counts)).toEqual([{ at: day(20, 15, 1), qty: 12 }, { at: day(21, 9), qty: 9.75 }]);
    expect(ledgerNeedsEventsAfter(full.counts)).toBe(day(20, 15, 1));
    const trimmed = trimLedgerToLatestCounts(full);
    expect(trimmed.receipts.map(r => r.at)).toEqual([day(21, 7), day(21, 12)]);
    expect(trimmed.usage.map(u => u.at)).toEqual([day(20, 16), day(21, 9), day(21, 10), day(21, 11)]);
  });

  it("gives the same expected stock and latest variance at any moment after the last count", () => {
    const trimmed = trimLedgerToLatestCounts(full);
    for (const now of [day(21, 9), day(21, 10, 30), day(21, 18), day(23, 6)]) {
      expect(expectedAt(trimmed, now)).toEqual(expectedAt(full, now));
    }
    expect(countVariances(trimmed).at(-1)).toEqual(countVariances(full).at(-1));
  });

  it("gives the Orders line the same stock figure, for any selected plan", () => {
    const trimmed = trimLedgerToLatestCounts(full);
    for (const [today, nowMs] of [["2026-10-21", day(21, 14)], ["2026-10-22", day(22, 14)]] as const) {
      for (const selectedPlanId of [7, 8, 9, 99]) {
        const args = {
          snapshotStock: 9.75,
          stockCheckEnabled: true,
          nowMs,
          today,
          toLondonDate: (ms: number) => new Date(ms).toISOString().slice(0, 10),
          selectedPlanId,
        };
        for (const checkedDaily of [true, false]) {
          expect(orderLineStock({ ...args, checkedDaily, ledger: trimmed })).toEqual(orderLineStock({ ...args, checkedDaily, ledger: full }));
        }
      }
    }
  });

  it("a run of near-duplicate counts is cut at its LAST count, as mergeCounts collapses it", () => {
    const chain = ledger({
      counts: [
        { at: day(10, 9), qty: 5 },
        { at: day(12, 9), qty: 8 },
        { at: day(12, 9) + 90_000, qty: 7 },
        { at: day(12, 9) + 180_000, qty: 6 }, // 1.5 min after the one before: same count
      ],
      usage: [
        { at: day(12, 9) + 60_000, qty: 1, source: "prep", planId: 1 },
        { at: day(13, 9), qty: 2, source: "prep", planId: 1 },
      ],
    });
    expect(latestTwoCounts(chain.counts)).toEqual([{ at: day(10, 9), qty: 5 }, { at: day(12, 9) + 180_000, qty: 6 }]);
    const trimmed = trimLedgerToLatestCounts(chain);
    expect(expectedAt(trimmed, day(14))).toEqual(expectedAt(chain, day(14)));
    expect(countVariances(trimmed).at(-1)).toEqual(countVariances(chain).at(-1));
  });

  it("one count: kept with everything after it; never counted: nothing is needed", () => {
    const once = ledger({ counts: [{ at: day(5), qty: 3 }], receipts: [{ at: day(4), qty: 9 }, { at: day(6), qty: 1 }] });
    expect(ledgerNeedsEventsAfter(once.counts)).toBe(day(5));
    expect(trimLedgerToLatestCounts(once).receipts).toEqual([{ at: day(6), qty: 1 }]);
    expect(expectedAt(trimLedgerToLatestCounts(once), day(7))).toEqual(expectedAt(once, day(7)));

    const never = ledger({ receipts: [{ at: day(4), qty: 9 }], usage: [{ at: day(4), qty: 1, source: "waste", planId: null }] });
    expect(ledgerNeedsEventsAfter(never.counts)).toBeNull();
    expect(trimLedgerToLatestCounts(never)).toEqual(ledger({}));
    expect(expectedAt(never, day(7))).toBeNull();
  });
});
