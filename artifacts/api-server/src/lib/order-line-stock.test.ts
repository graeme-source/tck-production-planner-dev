import { describe, expect, it } from "vitest";
import { orderLineStock } from "./order-line-stock";
import type { IngredientLedger } from "./stock-ledger";

const at = (d: number, h: number) => Date.UTC(2026, 9, d, h);
const toLondonDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const ledger: IngredientLedger = {
  coverage: "tracked",
  counts: [{ at: at(12, 14), qty: 6 }, { at: at(13, 14), qty: 4 }],
  receipts: [{ at: at(13, 7), qty: 10 }, { at: at(14, 7), qty: 10 }],
  usage: [
    { at: at(13, 10), qty: 11, source: "prep", planId: 1 },
    { at: at(14, 10), qty: 7.5, source: "prep", planId: 2 },
  ],
};

const base = { ledger, snapshotStock: 14, stockCheckEnabled: true, nowMs: at(14, 15), toLondonDate, selectedPlanId: 3 };

describe("orderLineStock", () => {
  it("not counted today: orders from the expected figure and says what it's built from", () => {
    const s = orderLineStock({ ...base, today: "2026-10-14" });
    expect(s.basis).toBe("expected");
    expect(s.stockOnHand).toBe(6.5); // 4 + 10 − 7.5
    expect(s.outstandingPrepFromNow).toBe(true);
    expect(s.expectedStock).toMatchObject({ qty: 6.5, basedOnCountQty: 4, receiptsSince: 10, usageSince: 7.5, coverage: "tracked" });
    expect(s.expectedStock!.basedOnCountAt).toBe(new Date(at(13, 14)).toISOString());
  });

  it("counted today: uses the count, and quietly carries what was expected at that count", () => {
    const s = orderLineStock({ ...base, nowMs: at(13, 15), today: "2026-10-13" });
    expect(s.basis).toBe("count");
    expect(s.stockOnHand).toBe(14);
    expect(s.outstandingPrepFromNow).toBe(false);
    expect(s.expectedAtLastCount).toBe(5); // 6 + 10 − 11
  });

  it("kanban item never counted: no expected figure, as before", () => {
    const s = orderLineStock({ ...base, ledger: { ...ledger, counts: [] }, stockCheckEnabled: false, today: "2026-10-14" });
    expect(s.basis).toBe("not-counted");
    expect(s.expectedStock).toBeNull();
    expect(s.stockOnHand).toBe(14);
  });

  it("nothing uses it: no expected figure (it would only ever grow)", () => {
    const s = orderLineStock({ ...base, ledger: { ...ledger, coverage: "untracked" }, today: "2026-10-14" });
    expect(s.basis).toBe("count");
    expect(s.expectedStock).toBeNull();
  });
});
