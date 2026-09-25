import { describe, it, expect } from "vitest";
import {
  arrivedTodayChange,
  buildUnexpectedPurchaseOrder,
  rankOpenOrderMatches,
  unexpectedLineUnit,
  type CatalogueItemInfo,
  type OpenOrderCandidate,
} from "./unexpected-delivery";
import { receiptDelta, stockQuantityForReceipt } from "./goods-in-stock";

const TODAY = "2026-09-25";

function order(id: number, supplierId: number, date: string | null, ingredientIds: number[]): OpenOrderCandidate {
  return {
    id,
    supplierId,
    supplierName: `Supplier ${supplierId}`,
    expectedDeliveryDate: date,
    lines: ingredientIds.map(i => ({ ingredientId: i, name: `Item ${i}`, quantityOrdered: 1, unit: "packs" })),
  };
}

describe("rankOpenOrderMatches — 'Is it one of these?'", () => {
  it("offers an open order containing the same item first, even when booked for another day", () => {
    const candidates = [
      order(1, 7, TODAY, [99]),          // same supplier, today, different item
      order(2, 7, "2026-10-02", [10]),   // same supplier, next week, SAME item
      order(3, 8, "2026-09-26", [55]),   // unrelated
    ];
    const ranked = rankOpenOrderMatches(candidates, { supplierId: 7, ingredientIds: [10] }, TODAY);
    expect(ranked.map(r => r.id)).toEqual([2, 1]);
    expect(ranked[0].reasons).toContain("Has this item on it");
    expect(ranked[0].daysFromToday).toBe(7);
  });

  it("finds an overdue order from the past for the same items", () => {
    const ranked = rankOpenOrderMatches([order(4, 3, "2026-09-10", [10, 11])], { supplierId: null, ingredientIds: [10, 11] }, TODAY);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].daysFromToday).toBe(-15);
    expect(ranked[0].reasons[0]).toBe("Has all 2 of your items");
  });

  it("ranks orders covering more of the basket above partial ones", () => {
    const ranked = rankOpenOrderMatches(
      [order(5, 3, TODAY, [10]), order(6, 3, "2026-09-29", [10, 11, 12])],
      { supplierId: 3, ingredientIds: [10, 11, 12] },
      TODAY,
    );
    expect(ranked[0].id).toBe(6);
    expect(ranked[1].reasons[0]).toBe("Has 1 of your 3 items");
  });

  it("among same-supplier orders with no shared items, the one closest to today comes first", () => {
    const ranked = rankOpenOrderMatches(
      [order(7, 3, "2026-10-20", [1]), order(8, 3, "2026-09-24", [2])],
      { supplierId: 3, ingredientIds: [] },
      TODAY,
    );
    expect(ranked.map(r => r.id)).toEqual([8, 7]);
    expect(ranked[0].reasons).toEqual(["Same supplier"]);
  });

  it("leaves out orders booked more than 60 days ago — stale, never booked in", () => {
    const ranked = rankOpenOrderMatches(
      [order(11, 3, "2026-04-01", [10]), order(12, 3, "2026-07-28", [10]), order(13, 3, "2027-01-10", [10])],
      { supplierId: 3, ingredientIds: [10] },
      TODAY,
    );
    expect(ranked.map(r => r.id).sort()).toEqual([12, 13]);
  });

  it("offers nothing when no open order shares the supplier or any item", () => {
    expect(rankOpenOrderMatches([order(9, 4, TODAY, [1])], { supplierId: 3, ingredientIds: [2] }, TODAY)).toEqual([]);
  });

  it("copes with orders that have no date and with misc lines", () => {
    const c: OpenOrderCandidate = {
      id: 10, supplierId: 3, supplierName: "S", expectedDeliveryDate: null,
      lines: [{ ingredientId: null, name: "Sample box", quantityOrdered: 1, unit: "each" }],
    };
    const ranked = rankOpenOrderMatches([c], { supplierId: 3, ingredientIds: [] }, TODAY);
    expect(ranked[0].daysFromToday).toBeNull();
  });
});

describe("arrivedTodayChange — receiving an open order on a different day", () => {
  it("moves it to today and remembers the booked date", () => {
    expect(arrivedTodayChange({ status: "placed", expectedDeliveryDate: "2026-10-02", originallyExpectedDate: null }, TODAY))
      .toEqual({ ok: true, change: { expectedDeliveryDate: TODAY, originallyExpectedDate: "2026-10-02" } });
  });
  it("keeps the first booked date if it was moved before", () => {
    const r = arrivedTodayChange({ status: "placed", expectedDeliveryDate: "2026-10-02", originallyExpectedDate: "2026-09-20" }, TODAY);
    expect(r).toEqual({ ok: true, change: { expectedDeliveryDate: TODAY, originallyExpectedDate: "2026-09-20" } });
  });
  it("changes nothing for an order already due today", () => {
    expect(arrivedTodayChange({ status: "placed", expectedDeliveryDate: TODAY, originallyExpectedDate: null }, TODAY))
      .toEqual({ ok: true, change: null });
  });
  it("refuses a received order", () => {
    expect(arrivedTodayChange({ status: "received", expectedDeliveryDate: "2026-09-20", originallyExpectedDate: null }, TODAY).ok).toBe(false);
  });
});

const CATALOGUE = new Map<number, CatalogueItemInfo>([
  [10, { id: 10, name: "Mozzarella", unit: "kg", packWeight: "2.5", costPerPack: "11.80" }],
  [11, { id: 11, name: "Pizza boxes", unit: "pieces", packWeight: "0", costPerPack: "0" }],
]);
const CTX = { today: TODAY, now: new Date("2026-09-25T09:30:00Z"), userId: 42 };

describe("buildUnexpectedPurchaseOrder — 'No, it's a different delivery'", () => {
  it("creates a new unexpected order due today, placed by the person at the door", () => {
    const r = buildUnexpectedPurchaseOrder(
      { supplierId: 7, lines: [{ kind: "item", ingredientId: 10, quantity: 4 }], notes: " came on back order " },
      CATALOGUE, CTX,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.order).toEqual({
      supplierId: 7,
      status: "placed",
      origin: "unexpected",
      expectedDeliveryDate: TODAY,
      placedAt: CTX.now,
      placedByUserId: 42,
      notes: "came on back order",
    });
    expect(r.value.lines).toEqual([{
      ingredientId: 10, description: null, quantityRequired: "0", quantityOrdered: "4",
      quantityReceived: "0", unit: "packs", unitPrice: "11.8",
    }]);
  });

  it("uses an edited price instead of the catalogue cost", () => {
    const r = buildUnexpectedPurchaseOrder(
      { supplierId: 7, lines: [{ kind: "item", ingredientId: 10, quantity: 1, unitPrice: 12.5 }] }, CATALOGUE, CTX,
    );
    expect(r.ok && r.value.lines[0].unitPrice).toBe("12.5");
  });

  it("counts items with no pack weight in their own unit, not packs", () => {
    expect(unexpectedLineUnit(CATALOGUE.get(11)!)).toBe("pieces");
    const r = buildUnexpectedPurchaseOrder(
      { supplierId: 7, lines: [{ kind: "item", ingredientId: 11, quantity: 200 }] }, CATALOGUE, CTX,
    );
    expect(r.ok && r.value.lines[0]).toMatchObject({ unit: "pieces", unitPrice: null });
  });

  it("carries a free-text line for something not in the system", () => {
    const r = buildUnexpectedPurchaseOrder(
      { supplierId: 7, lines: [{ kind: "misc", description: "  Sample sauce  ", quantity: 2, unitPrice: null }] }, CATALOGUE, CTX,
    );
    expect(r.ok && r.value.lines[0]).toMatchObject({ ingredientId: null, description: "Sample sauce", unit: "each", quantityOrdered: "2" });
  });

  it("rejects empty baskets, zero quantities, unknown items, blank misc lines and duplicates", () => {
    expect(buildUnexpectedPurchaseOrder({ supplierId: 7, lines: [] }, CATALOGUE, CTX).ok).toBe(false);
    expect(buildUnexpectedPurchaseOrder({ supplierId: 7, lines: [{ kind: "item", ingredientId: 10, quantity: 0 }] }, CATALOGUE, CTX).ok).toBe(false);
    expect(buildUnexpectedPurchaseOrder({ supplierId: 7, lines: [{ kind: "item", ingredientId: 999, quantity: 1 }] }, CATALOGUE, CTX).ok).toBe(false);
    expect(buildUnexpectedPurchaseOrder({ supplierId: 7, lines: [{ kind: "misc", description: "  ", quantity: 1 }] }, CATALOGUE, CTX).ok).toBe(false);
    expect(buildUnexpectedPurchaseOrder({
      supplierId: 7,
      lines: [{ kind: "item", ingredientId: 10, quantity: 1 }, { kind: "item", ingredientId: 10, quantity: 2 }],
    }, CATALOGUE, CTX).ok).toBe(false);
  });
});

describe("regression: an unexpected delivery adds stock exactly once", () => {
  it("creating the order adds nothing; receiving adds it; re-saving the receipt adds nothing more", () => {
    const r = buildUnexpectedPurchaseOrder(
      { supplierId: 7, lines: [{ kind: "item", ingredientId: 10, quantity: 4 }] }, CATALOGUE, CTX,
    );
    if (!r.ok) throw new Error(r.error);
    const line = r.value.lines[0];
    const info = { unit: line.unit, packWeight: CATALOGUE.get(10)!.packWeight, ingredientUnit: "kg" };

    // Created with nothing received — the create step never touches stock.
    const receivedOnCreate = Number(line.quantityReceived);
    expect(receivedOnCreate).toBe(0);

    // The normal receive step: 4 packs counted at the door → 10 kg into stock.
    const firstDelta = receiptDelta(receivedOnCreate, 4);
    expect(stockQuantityForReceipt(firstDelta, info)).toEqual({ quantity: 10, unit: "kg" });

    // Saving the same receipt again (edit, double tap) moves stock by zero.
    const secondDelta = receiptDelta(4, 4);
    expect(stockQuantityForReceipt(secondDelta, info).quantity).toBe(0);
  });
});
