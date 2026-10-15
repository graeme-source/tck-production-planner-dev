import { describe, expect, it } from "vitest";
import {
  canCompleteGoodsIn, effectiveReceived, formatReportQty, initialDecision, initialQuantity, lineStatus,
  lineToSubmit, newlyAdded, orderShortage, reportAction, reportRecipients, shortLinesOf, shortReportText,
  shortSignature, undecidedLines, type ReportLineInput,
} from "./index";

describe("effectiveReceived — the server rule (regression: 15 Oct Brakes delivery)", () => {
  it("an un-ticked line counts as 0 whatever quantity the screen sent", () => {
    expect(effectiveReceived(false, 8)).toBe(0);
    expect(effectiveReceived(undefined, 8)).toBe(0);
    expect(effectiveReceived(null, 8)).toBe(0);
  });
  it("a ticked line counts its quantity", () => {
    expect(effectiveReceived(true, 6)).toBe(6);
    expect(effectiveReceived(true, 0)).toBe(0);
    expect(effectiveReceived(true, -2)).toBe(0);
    expect(effectiveReceived(true, Number.NaN)).toBe(0);
  });
});

describe("lineStatus — what the deliveries page shows", () => {
  const line = (ordered: number, received: number, checked: boolean | undefined) =>
    ({ quantityOrdered: ordered, quantityReceived: received, goodsInChecked: checked });
  it("is pending until the order is received", () => {
    expect(lineStatus(false, line(8, 8, true))).toBe("pending");
  });
  it("green only when ticked and at least the ordered amount arrived", () => {
    expect(lineStatus(true, line(8, 8, true))).toBe("received");
    expect(lineStatus(true, line(8, 9, true))).toBe("received");
  });
  it("short when ticked with less than ordered", () => {
    expect(lineStatus(true, line(8, 6, true))).toBe("short");
  });
  it("not received when nothing arrived, ticked or not", () => {
    expect(lineStatus(true, line(8, 0, false))).toBe("not_received");
    expect(lineStatus(true, line(8, 0, true))).toBe("not_received");
  });
  it("an old receipt with stock booked but no tick is flagged, never green", () => {
    expect(lineStatus(true, line(8, 8, false))).toBe("unconfirmed");
  });
});

describe("orderShortage", () => {
  it("counts short and missing lines as items short", () => {
    const s = orderShortage(true, [
      { quantityOrdered: 8, quantityReceived: 0, goodsInChecked: false },
      { quantityOrdered: 10, quantityReceived: 6, goodsInChecked: true },
      { quantityOrdered: 5, quantityReceived: 5, goodsInChecked: true },
      { quantityOrdered: 5, quantityReceived: 5, goodsInChecked: false },
    ]);
    expect(s).toMatchObject({ short: 1, notReceived: 1, unconfirmed: 1, itemsShort: 2, label: "2 items short" });
  });
  it("says nothing for a full delivery or one not yet received", () => {
    expect(orderShortage(true, [{ quantityOrdered: 1, quantityReceived: 1, goodsInChecked: true }]).label).toBeNull();
    expect(orderShortage(false, [{ quantityOrdered: 1, quantityReceived: 0, goodsInChecked: false }]).label).toBeNull();
  });
  it("one item reads singular", () => {
    expect(orderShortage(true, [{ quantityOrdered: 1, quantityReceived: 0, goodsInChecked: false }]).label).toBe("1 item short");
  });
});

describe("receive dialog decisions", () => {
  it("every line starts undecided before goods-in, so each has to be looked at", () => {
    expect(initialDecision(false, { quantityOrdered: 8, quantityReceived: 0, goodsInChecked: false })).toBeNull();
  });
  it("re-opening a received order keeps what was recorded", () => {
    expect(initialDecision(true, { quantityOrdered: 8, quantityReceived: 6, goodsInChecked: true })).toBe("received");
    expect(initialDecision(true, { quantityOrdered: 8, quantityReceived: 0, goodsInChecked: false })).toBe("not_received");
  });
  it("an old un-ticked receipt with stock booked must be decided again", () => {
    expect(initialDecision(true, { quantityOrdered: 8, quantityReceived: 8, goodsInChecked: false })).toBeNull();
  });
  it("the quantity box opens at what was recorded, else what was ordered", () => {
    expect(initialQuantity({ quantityOrdered: 8, quantityReceived: 0, goodsInChecked: false })).toBe(8);
    expect(initialQuantity({ quantityOrdered: 8, quantityReceived: 6, goodsInChecked: true })).toBe(6);
  });
  it("never sends a quantity for a line that isn't received", () => {
    expect(lineToSubmit({ decision: "not_received", quantity: 8 })).toEqual({ checked: false, quantityReceived: 0 });
    expect(lineToSubmit({ decision: null, quantity: 8 })).toEqual({ checked: false, quantityReceived: 0 });
    expect(lineToSubmit({ decision: "received", quantity: 0 })).toEqual({ checked: false, quantityReceived: 0 });
    expect(lineToSubmit({ decision: "received", quantity: 6 })).toEqual({ checked: true, quantityReceived: 6 });
  });
  it("can't complete while any line is undecided, and says which", () => {
    const lines = [{ decision: "received" as const }, { decision: null }, { decision: "not_received" as const }, { decision: null }];
    expect(undecidedLines(lines)).toEqual([1, 3]);
    expect(canCompleteGoodsIn(lines)).toBe(false);
    expect(canCompleteGoodsIn([{ decision: "received" }, { decision: "not_received" }])).toBe(true);
  });
});

const milk: ReportLineInput = { lineId: 2562, name: "Whole milk (FOR CINNAMON BUNS ONLY)", quantityOrdered: 8, quantityReceived: 0, unit: "Bottles" };
const beef: ReportLineInput = { lineId: 2555, name: "Diced Beef", quantityOrdered: 15, quantityReceived: 10, unit: "kg", nativeUnit: "kg", packWeight: 2.5, stockInPacks: false };
const feta: ReportLineInput = { lineId: 2559, name: "Greek Feta Cheese", quantityOrdered: 8000, quantityReceived: 8000, unit: "g", nativeUnit: "g", packWeight: 800, stockInPacks: true };

describe("short lines + report text", () => {
  it("lists only lines below what was ordered, missing first", () => {
    const short = shortLinesOf([beef, feta, milk]);
    expect(short.map(l => l.lineId)).toEqual([2562, 2555]);
    expect(short[0].missing).toBe(true);
    expect(short[1].missing).toBe(false);
  });
  it("ignores lines added at the door with nothing ordered", () => {
    expect(shortLinesOf([{ ...milk, quantityOrdered: 0 }])).toEqual([]);
  });
  it("quantities read the way people say them", () => {
    expect(formatReportQty(8, milk)).toBe("8 bottles");
    expect(formatReportQty(15, beef)).toBe("15 kg");
    expect(formatReportQty(4000, feta)).toBe("5 packs");
    expect(formatReportQty(0, milk)).toBe("0");
  });
  it("reads like a short report", () => {
    const { title, notes } = shortReportText(shortLinesOf([milk, beef]), {
      supplierName: "Brakes Food Service", purchaseOrderId: 673, receivedByName: "Lorna",
      receivedTime: "07:02", receivedDay: "Thu 15 Oct", note: "Needed for cinnamon buns today — someone needs to buy milk",
    });
    expect(title).toBe("Short delivery: Brakes Food Service (PO #673) — 2 items short");
    expect(notes).toContain("Received by Lorna at 07:02 on Thu 15 Oct.");
    expect(notes).toContain("• Whole milk (FOR CINNAMON BUNS ONLY) — ordered 8 bottles, received 0");
    expect(notes).toContain("• Diced Beef — ordered 15 kg, received 10 kg");
    expect(notes).toContain("Note: Needed for cinnamon buns today — someone needs to buy milk");
  });
  it("all-missing says not delivered; an update is labelled", () => {
    const { title } = shortReportText(shortLinesOf([milk]), {
      supplierName: "Brakes", purchaseOrderId: 1, receivedByName: null, receivedTime: "09:00", receivedDay: "Thu 15 Oct", update: true,
    });
    expect(title).toBe("Update — Short delivery: Brakes (PO #1) — 1 item not delivered");
  });
  it("a follow-up with nothing short says it's all received", () => {
    const { title } = shortReportText([], { supplierName: "Brakes", purchaseOrderId: 1, receivedByName: "Sam", receivedTime: "10:00", receivedDay: "Thu 15 Oct", update: true });
    expect(title).toContain("now all received");
  });
});

describe("reportAction — one report per delivery, no spam", () => {
  const short = shortLinesOf([milk, beef]);
  it("first report only when something is short", () => {
    expect(reportAction(null, short)).toEqual({ kind: "create" });
    expect(reportAction(null, [])).toEqual({ kind: "none" });
  });
  it("re-saving the same shortfall sends nothing new", () => {
    expect(reportAction(shortSignature(short), shortLinesOf([beef, milk]))).toEqual({ kind: "same" });
  });
  it("an edit that changes the shortfall is a follow-up; fixing it all is 'resolved'", () => {
    const sig = shortSignature(short);
    expect(reportAction(sig, shortLinesOf([milk]))).toEqual({ kind: "changed", resolved: false });
    expect(reportAction(sig, [])).toEqual({ kind: "changed", resolved: true });
  });
});

describe("reportRecipients", () => {
  it("uses the people chosen at goods-in (removing a configured one counts), no duplicates", () => {
    expect(reportRecipients({ configured: [2, 3], chosen: [3, 5, 5], senderId: 9 })).toEqual({ all: [3, 5], bells: [3, 5] });
  });
  it("with no choice made: configured plus whoever was told before, merged", () => {
    expect(reportRecipients({ configured: [2, 3], previous: [3, 7], senderId: 9 })).toEqual({ all: [2, 3, 7], bells: [2, 3, 7] });
  });
  it("the sender gets the to-do but never a bell for their own report", () => {
    expect(reportRecipients({ configured: [2, 4], chosen: undefined, senderId: 4 })).toEqual({ all: [2, 4], bells: [2] });
  });
  it("drops junk ids", () => {
    expect(reportRecipients({ configured: [0, -1, 3], senderId: null }).all).toEqual([3]);
  });
  it("newlyAdded tells only people not told before", () => {
    expect(newlyAdded([2, 3, 5], [3])).toEqual([2, 5]);
  });
});
