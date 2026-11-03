import { describe, expect, it } from "vitest";
import { placedOnDay, suppliersOrderedToday, type PurchaseOrderForToday } from "./ordered-today";
import { londonDateString } from "./london-time";

const TODAY = "2026-11-02";
const po = (over: Partial<PurchaseOrderForToday>): PurchaseOrderForToday => ({
  id: 748,
  supplierId: 7,
  supplierName: "Fruit supplier",
  status: "placed",
  placedAt: new Date("2026-11-02T10:30:00Z"),
  origin: "planned",
  ...over,
});

describe("an order placed today hides the supplier's automatic card (#351/#384)", () => {
  it("placed this morning → ordered today (the #748 milk/cream case)", () => {
    expect(placedOnDay(po({}), TODAY, londonDateString)).toBe(true);
  });

  it("still counts after it's past the supplier's cutoff — the card must not come back half an hour later", () => {
    // Nothing about the cutoff matters: placed today is placed today.
    expect(placedOnDay(po({ placedAt: new Date("2026-11-02T16:55:00Z") }), TODAY, londonDateString)).toBe(true);
  });

  it("delivered already (received) or part-delivered still counts — it was ordered today", () => {
    expect(placedOnDay(po({ status: "received" }), TODAY, londonDateString)).toBe(true);
    expect(placedOnDay(po({ status: "partially_received" }), TODAY, londonDateString)).toBe(true);
  });

  it("placed yesterday → doesn't count, the normal maths runs today", () => {
    expect(placedOnDay(po({ placedAt: new Date("2026-11-01T15:00:00Z") }), TODAY, londonDateString)).toBe(false);
  });

  it("a draft (never sent) doesn't count", () => {
    expect(placedOnDay(po({ status: "draft", placedAt: null }), TODAY, londonDateString)).toBe(false);
    expect(placedOnDay(po({ status: "draft" }), TODAY, londonDateString)).toBe(false);
  });

  it("a cancelled or unknown status doesn't count", () => {
    expect(placedOnDay(po({ status: "cancelled" }), TODAY, londonDateString)).toBe(false);
  });

  it("an unexpected delivery logged at the door isn't an order we placed", () => {
    expect(placedOnDay(po({ origin: "unexpected" }), TODAY, londonDateString)).toBe(false);
  });

  it("uses London's day, not UTC: 23:30 UTC in BST is already tomorrow in London", () => {
    // 2026-07-14 23:30 UTC = 2026-07-15 00:30 BST.
    const late = po({ placedAt: new Date("2026-07-14T23:30:00Z") });
    expect(placedOnDay(late, "2026-07-15", londonDateString)).toBe(true);
    expect(placedOnDay(late, "2026-07-14", londonDateString)).toBe(false);
  });
});

describe("the 'Ordered today' list", () => {
  it("one entry per supplier, A–Z, with all of today's order numbers", () => {
    const list = suppliersOrderedToday([
      po({ id: 750, supplierId: 9, supplierName: "Express" }),
      po({ id: 752, supplierId: 7, supplierName: "AB Fruits" }),
      po({ id: 748, supplierId: 7, supplierName: "AB Fruits" }),
      po({ id: 700, supplierId: 3, supplierName: "Butcher", placedAt: new Date("2026-10-30T09:00:00Z") }),
      po({ id: 751, supplierId: 4, supplierName: "Door drop", origin: "unexpected" }),
    ], TODAY, londonDateString);
    expect(list).toEqual([
      { supplierId: 7, supplierName: "AB Fruits", orderIds: [748, 752] },
      { supplierId: 9, supplierName: "Express", orderIds: [750] },
    ]);
  });

  it("nothing ordered today → empty", () => {
    expect(suppliersOrderedToday([po({ placedAt: new Date("2026-11-01T09:00:00Z") })], TODAY, londonDateString)).toEqual([]);
  });

  it("a supplier with no name still shows", () => {
    expect(suppliersOrderedToday([po({ supplierName: null })], TODAY, londonDateString)[0].supplierName).toBe("Supplier #7");
  });
});
