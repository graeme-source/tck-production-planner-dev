import { describe, it, expect } from "vitest";
import { decisionForQuantity, receivingColumns, rowQuantity, rowTone } from "./receiving-row";

describe("rowQuantity", () => {
  it("shows and steps plain lines in their own unit, by 0.5", () => {
    const q = rowQuantity({ unit: "kg", quantityOrdered: 10, quantityReceived: 9.5 });
    expect(q.inPacks).toBe(false);
    expect(q.step).toBe(0.5);
    expect(q.receivedShown).toBe(9.5);
    expect(q.storedAfterStep(0.5)).toBe(10);
    expect(q.storedAfterStep(-0.5)).toBe(9);
    expect(q.storedFromTyped(7.25)).toBe(7.25);
  });

  it("never steps below zero", () => {
    const q = rowQuantity({ unit: "kg", quantityOrdered: 1, quantityReceived: 0.2 });
    expect(q.storedAfterStep(-0.5)).toBe(0);
  });

  it("counts whole packs for pack-counted lines stored by weight", () => {
    // 12 boxes of 5 kg, stored as 60 kg.
    const q = rowQuantity({ unit: "kg", quantityOrdered: 60, quantityReceived: 55, stockInPacks: true, packWeight: 5 });
    expect(q.inPacks).toBe(true);
    expect(q.step).toBe(1);
    expect(q.orderedPacks).toBe(12);
    expect(q.receivedShown).toBe(11);
    expect(q.storedAfterStep(1)).toBe(60);
    expect(q.storedFromTyped(10)).toBe(50);
  });

  it("leaves lines already stored as a pack count alone", () => {
    const q = rowQuantity({ unit: "packs", quantityOrdered: 4, quantityReceived: 3, stockInPacks: true, packWeight: 2.5 });
    expect(q.orderedPacks).toBe(4);
    expect(q.receivedShown).toBe(3);
    expect(q.storedAfterStep(1)).toBe(4);
    expect(q.storedFromTyped(2)).toBe(2);
  });

  it("treats stock-in-packs with no pack weight as a plain line", () => {
    const q = rowQuantity({ unit: "kg", quantityOrdered: 3, quantityReceived: 3, stockInPacks: true, packWeight: 0 });
    expect(q.inPacks).toBe(false);
    expect(q.step).toBe(0.5);
  });
});

describe("decisionForQuantity", () => {
  it("is Received above zero and Not received at zero", () => {
    expect(decisionForQuantity(0.5)).toBe("received");
    expect(decisionForQuantity(0)).toBe("not_received");
  });
});

describe("rowTone", () => {
  const base = { decision: "received" as const, quantityOrdered: 10, quantityReceived: 10, shelfLifeShort: false, requiresUseByDate: false, useByDate: "" };

  it("is undecided until someone taps", () => {
    expect(rowTone({ ...base, decision: null })).toBe("undecided");
  });
  it("is green when received in full", () => {
    expect(rowTone(base)).toBe("received");
  });
  it("is amber when the quantity differs from the order", () => {
    expect(rowTone({ ...base, quantityReceived: 8 })).toBe("discrepancy");
    expect(rowTone({ ...base, quantityReceived: 12 })).toBe("discrepancy");
  });
  it("flags a missing required use-by above a short quantity", () => {
    expect(rowTone({ ...base, quantityReceived: 8, requiresUseByDate: true })).toBe("use_by_missing");
    expect(rowTone({ ...base, requiresUseByDate: true, useByDate: "2026-11-20" })).toBe("received");
  });
  it("puts short shelf life above a missing use-by", () => {
    expect(rowTone({ ...base, shelfLifeShort: true, requiresUseByDate: true })).toBe("shelf_life_short");
  });
  it("is red for Not received whatever else is set", () => {
    expect(rowTone({ ...base, decision: "not_received", shelfLifeShort: true, quantityReceived: 0 })).toBe("not_received");
  });
});

describe("receivingColumns", () => {
  it("adds the Use-by column only when a line needs one", () => {
    expect(receivingColumns({ anyUseBy: false, wide: false }).split(" ")).toHaveLength(4);
    expect(receivingColumns({ anyUseBy: true, wide: false }).split(" ")).toHaveLength(5);
  });
  it("has no separate Ordered column — the quantity sits in front of the name", () => {
    expect(receivingColumns({ anyUseBy: true, wide: true }).split(" ")).toHaveLength(5);
  });
  it("leaves room between tick and cross (two 44 px buttons plus a wide gap)", () => {
    expect(receivingColumns({ anyUseBy: false, wide: false }).split(" ")[0]).toBe("8rem");
  });
  it("gives only the item a flexible width, so rows line up", () => {
    const tracks = receivingColumns({ anyUseBy: true, wide: true }).split(" ");
    expect(tracks.filter((t) => t.includes("fr"))).toEqual(["minmax(10rem,1fr)"]);
    expect(tracks.some((t) => t.includes("auto"))).toBe(false);
  });
});
