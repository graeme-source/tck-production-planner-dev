import { describe, expect, it } from "vitest";
import { matchSupplierInvoices, needsALook, type MatchDelivery, type MatchInvoice } from "./delivery-matching";

// Shapes taken from the real Sep–Nov 2026 invoices and goods-in records.
const LINER = 249;
const BOXES = 240;
const LABELS = 279;
const MINCE = 306;
const PORK = 22;

const inv = (id: number, date: string, total: number, lines: MatchInvoice["lines"]): MatchInvoice => ({ id, date, number: `N${id}`, total, lines });
const del = (id: number, date: string, lines: MatchDelivery["lines"]): MatchDelivery => ({ id, date, lines });
const liner = (q: number) => [{ ingredientId: LINER, nativeQty: q, isCharge: false }];

describe("matchSupplierInvoices", () => {
  // Puffin: invoice one day, delivery the next; invoices always say 1,200
  // liners for the 600 we count. 12 Oct's invoice has no delivery near it.
  const puffinInvoices = [
    inv(1, "2026-09-03", 1065.6, liner(1200)),
    inv(2, "2026-09-14", 1065.6, liner(1200)),
    inv(3, "2026-09-22", 1065.6, liner(1200)),
    inv(4, "2026-10-05", 1065.6, liner(1200)),
    inv(5, "2026-10-12", 1065.6, liner(1200)),
    inv(6, "2026-10-20", 1065.6, liner(1200)),
    inv(7, "2026-11-06", 1065.6, liner(1200)),
  ];
  const puffinDeliveries = [
    del(11, "2026-09-04", [{ ingredientId: LINER, nativeQty: 600 }]),
    del(12, "2026-09-15", [{ ingredientId: LINER, nativeQty: 600 }]),
    del(13, "2026-09-23", [{ ingredientId: LINER, nativeQty: 600 }]),
    del(14, "2026-10-06", [{ ingredientId: LINER, nativeQty: 600 }]),
    del(16, "2026-10-21", [{ ingredientId: LINER, nativeQty: 600 }]),
    del(17, "2026-11-09", [{ ingredientId: LINER, nativeQty: 600 }]),
  ];

  it("learns Puffin's 2-for-1 count and its next-day gap", () => {
    const r = matchSupplierInvoices(puffinInvoices, puffinDeliveries, "2026-11-13");
    expect(r.profile.usualRatios[LINER]).toBe(2);
    expect(r.profile.typicalGapDays).toBe(1);
    expect(r.profile.lateAfterDays).toBe(14);
    const byId = Object.fromEntries(r.invoices.map((m) => [m.invoiceId, m]));
    expect(byId[1]).toMatchObject({ status: "matched", deliveryId: 11, gapDays: 1 });
    expect(byId[7]).toMatchObject({ status: "matched", deliveryId: 17, gapDays: 3 });
  });

  it("warns gently about the 12 Oct invoice with no delivery, naming its twin", () => {
    const r = matchSupplierInvoices(puffinInvoices, puffinDeliveries, "2026-11-13");
    const m = r.invoices.find((x) => x.invoiceId === 5)!;
    expect(m.status).toBe("no_delivery");
    expect(m.deliveryId).toBeNull();
    expect(m.sameAsInvoiceId).not.toBeNull();
    expect(needsALook(m)).toBe(true);
  });

  it("an invoice without its delivery yet is just waiting until two weeks have gone", () => {
    const r = matchSupplierInvoices([inv(1, "2026-11-10", 100, liner(1200))], [], "2026-11-20");
    expect(r.invoices[0].status).toBe("waiting");
    expect(needsALook(r.invoices[0])).toBe(false);
    const later = matchSupplierInvoices([inv(1, "2026-11-10", 100, liner(1200))], [], "2026-11-25");
    expect(later.invoices[0].status).toBe("no_delivery");
  });

  it("butcher weights a little over are fine; well over is a quantity difference", () => {
    const lines = (m: number, p: number) => [
      { ingredientId: MINCE, nativeQty: m, isCharge: false },
      { ingredientId: PORK, nativeQty: p, isCharge: false },
    ];
    const r = matchSupplierInvoices(
      [inv(1, "2026-11-12", 284.4, lines(18.03, 19.49)), inv(2, "2026-11-11", 300, lines(18, 38))],
      [del(1, "2026-11-12", [{ ingredientId: MINCE, nativeQty: 18 }, { ingredientId: PORK, nativeQty: 19 }]),
       del(2, "2026-11-11", [{ ingredientId: MINCE, nativeQty: 18 }, { ingredientId: PORK, nativeQty: 19 }])],
      "2026-11-13",
    );
    expect(r.invoices[0]).toMatchObject({ status: "matched", deliveryId: 1 });
    expect(r.invoices[1]).toMatchObject({ status: "quantity_differs", deliveryId: 2 });
    expect(r.invoices[1].differences).toEqual([{ ingredientId: PORK, invoiced: 38, received: 19 }]);
  });

  it("being invoiced for less than arrived is not a warning", () => {
    const r = matchSupplierInvoices(
      [inv(1, "2026-11-12", 50, [{ ingredientId: MINCE, nativeQty: 10, isCharge: false }])],
      [del(1, "2026-11-12", [{ ingredientId: MINCE, nativeQty: 18 }])],
      "2026-11-13",
    );
    expect(r.invoices[0].status).toBe("matched");
  });

  it("pairs by item, so a labels invoice weeks after the labels came isn't taken by a box delivery", () => {
    const boxes = (id: number, date: string) => inv(id, date, 250.73, [{ ingredientId: BOXES, nativeQty: 360, isCharge: false }]);
    const r = matchSupplierInvoices(
      [boxes(1, "2026-09-09"), boxes(2, "2026-09-16"), boxes(3, "2026-09-22"),
       inv(4, "2026-09-28", 1623.6, [{ ingredientId: LABELS, nativeQty: 30000, isCharge: false }, { ingredientId: null, nativeQty: null, isCharge: true }]),
       boxes(5, "2026-09-30")],
      [del(1, "2026-09-09", [{ ingredientId: BOXES, nativeQty: 360 }]),
       del(2, "2026-09-09", [{ ingredientId: LABELS, nativeQty: 30000 }]),
       del(3, "2026-09-16", [{ ingredientId: BOXES, nativeQty: 360 }]),
       del(4, "2026-09-22", [{ ingredientId: BOXES, nativeQty: 360 }]),
       del(5, "2026-09-30", [{ ingredientId: BOXES, nativeQty: 360 }])],
      "2026-11-13",
    );
    const labels = r.invoices.find((m) => m.invoiceId === 4)!;
    expect(labels).toMatchObject({ status: "matched", deliveryId: 2, gapDays: -19 });
    expect(r.invoices.find((m) => m.invoiceId === 5)).toMatchObject({ status: "matched", deliveryId: 5 });
    expect(r.deliveryInvoice[2]).toBe(4);
  });

  it("unread lines pair by date only, close to the usual gap, and say so", () => {
    const r = matchSupplierInvoices(
      [inv(1, "2026-11-01", 100, null), inv(2, "2026-11-01", 100, null)],
      [del(1, "2026-11-02", [{ ingredientId: BOXES, nativeQty: 1 }]), del(2, "2026-11-20", [{ ingredientId: BOXES, nativeQty: 1 }])],
      "2026-11-21",
    );
    expect(r.invoices[0]).toMatchObject({ status: "matched_by_date", deliveryId: 1 });
    // 19 days out is too far to guess on dates alone.
    expect(r.invoices[1].deliveryId).toBeNull();
  });

  it("an invoice nearly double the usual, with no delivery, is flagged", () => {
    const usual = [1, 2, 3, 4, 5].map((n) => inv(n, `2026-10-0${n}`, 250, null));
    const r = matchSupplierInvoices([...usual, inv(6, "2026-10-06", 500, null)], [], "2026-10-07");
    expect(r.invoices.find((m) => m.invoiceId === 6)!.unusualAmount).toBe(true);
    expect(r.invoices.find((m) => m.invoiceId === 1)!.unusualAmount).toBe(false);
  });
});

describe("pairing on real Sep–Oct 2026 shapes", () => {
  it("a perfect match a month away doesn't beat the delivery the next day (Puffin 28 Sep)", () => {
    const r = matchSupplierInvoices(
      [inv(1, "2026-09-28", 1065.6, liner(1200)), inv(2, "2026-10-12", 1065.6, liner(1200))],
      [del(1, "2026-08-27", [{ ingredientId: LINER, nativeQty: 1200 }]), del(2, "2026-09-29", [{ ingredientId: LINER, nativeQty: 1 }])],
      "2026-11-13",
    );
    // Goods-in typed 1 on 29 Sep: that's the delivery, and the difference is shown.
    expect(r.invoices[0]).toMatchObject({ deliveryId: 2, status: "quantity_differs" });
    // 12 Oct has nothing near it: no delivery.
    expect(r.invoices[1]).toMatchObject({ deliveryId: null, status: "no_delivery" });
  });

  it("a small invoice doesn't take a big delivery from the invoice that matches it (Best Butcher 7–8 Sep)", () => {
    const w = (id: number, q: number) => ({ ingredientId: id, nativeQty: q, weighed: true });
    const r = matchSupplierInvoices(
      [inv(1, "2026-09-07", 292.99, [{ ingredientId: PORK, nativeQty: 18.38, isCharge: false }, { ingredientId: MINCE, nativeQty: 18.18, isCharge: false }]),
       inv(2, "2026-09-08", 53.35, [{ ingredientId: MINCE, nativeQty: 5.1, isCharge: false }])],
      [del(1, "2026-09-07", [w(PORK, 18), w(MINCE, 18)]), del(2, "2026-09-08", [w(MINCE, 5)])],
      "2026-11-13",
    );
    expect(r.invoices[0]).toMatchObject({ deliveryId: 1, status: "matched" });
    expect(r.invoices[1]).toMatchObject({ deliveryId: 2, status: "matched" });
  });

  it("weighed goods get the butcher's leeway: 20.36 kg invoiced on 19 kg recorded is fine", () => {
    const r = matchSupplierInvoices(
      [inv(1, "2026-09-03", 257.17, [{ ingredientId: PORK, nativeQty: 20.36, isCharge: false }])],
      [del(1, "2026-09-03", [{ ingredientId: PORK, nativeQty: 19, weighed: true }])],
      "2026-11-13",
    );
    expect(r.invoices[0].status).toBe("matched");
  });
});

describe("deliveredNativeQty", () => {
  it("counts pallets, packs and plain units in the ingredient's own unit", async () => {
    const { deliveredNativeQty } = await import("./delivery-matching");
    expect(deliveredNativeQty(1, "pallets", 36, 50)).toBe(1800); // gel packs
    expect(deliveredNativeQty(1, "pallets", 0, 600)).toBe(600); // liners
    expect(deliveredNativeQty(1, "pallets", 360, 1)).toBe(360); // boxes
    expect(deliveredNativeQty(3, "packs", 36, null)).toBe(108);
    expect(deliveredNativeQty(18.2, "kg", 1, null)).toBe(18.2);
  });
});
