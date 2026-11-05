import { describe, expect, it } from "vitest";
import {
  canUseLastCheck,
  deliveredSinceLabel,
  expectedAtCountLabel,
  expectedStockBasisLine,
  expectedStockHeadline,
  expectedStockTooltip,
  lastCheckValue,
  lastCheckWhen,
  shouldSaveStockOnBlur,
  showsStockCheckButton,
  stockBoxStartsBlank,
  stockFromLastCheck,
  type ExpectedStock,
} from "./expected-stock-label";

const e: ExpectedStock = {
  qty: 4.2, basedOnCountQty: 3, basedOnCountAt: "2026-10-12T13:05:00.000Z",
  receiptsSince: 12.5, usageSince: 11.3, coverage: "tracked", coverageLabel: "Tracked",
};

describe("expected stock wording", () => {
  it("reads as an expectation, with what it's built from", () => {
    expect(expectedStockHeadline(e, "kg")).toBe("Expected ~4.2 kg");
    expect(expectedStockHeadline({ ...e, coverage: "estimated" }, "kg")).toBe("Expected ~4.2 kg (approx.)");
    expect(expectedStockBasisLine(e)).toBe("last counted 12 Oct, + deliveries − usage");
    expect(expectedStockTooltip(e, "kg")).toContain("+ 12.5 kg delivered since");
    expect(expectedAtCountLabel(4.199)).toBe("expected 4.2");
  });
});

describe("stock box", () => {
  it("starts blank for an expected figure or a never-counted kanban", () => {
    expect(stockBoxStartsBlank({ stockBasis: "expected", stockDirty: false })).toBe(true);
    expect(stockBoxStartsBlank({ stockCounted: false, stockBasis: "not-counted", stockDirty: false })).toBe(true);
    expect(stockBoxStartsBlank({ stockCounted: true, stockBasis: "count", stockDirty: false })).toBe(false);
    expect(stockBoxStartsBlank({ stockBasis: "expected", stockDirty: true })).toBe(false);
  });
  it("never saves an untouched blank box as a count", () => {
    expect(shouldSaveStockOnBlur({ stockBasis: "expected", stockDirty: false })).toBe(false);
    expect(shouldSaveStockOnBlur({ stockCounted: false, stockDirty: false })).toBe(false);
    expect(shouldSaveStockOnBlur({ stockBasis: "expected", stockDirty: true })).toBe(true);
    // A counted line saves on leave, as it always has.
    expect(shouldSaveStockOnBlur({ stockCounted: true, stockBasis: "count", stockDirty: false })).toBe(true);
  });
});

describe("Record stock check button on Orders (#336)", () => {
  it("is hidden for kanban items nobody stock-checks, including pulled kanbans", () => {
    expect(showsStockCheckButton({ isKanban: true, stockCounted: false })).toBe(false);
    // A pulled kanban added on screen before the server re-sends the line.
    expect(showsStockCheckButton({ isKanban: true })).toBe(false);
  });
  it("stays for stock-checked items, kanban or not", () => {
    expect(showsStockCheckButton({ isKanban: true, stockCounted: true })).toBe(true);
    expect(showsStockCheckButton({ isKanban: false, stockCounted: true })).toBe(true);
    expect(showsStockCheckButton({ isKanban: false })).toBe(true);
  });
  it("no button on a standing weekly order nobody counts — the day drives it (#348)", () => {
    const standingOrder = { label: "Every Fri", packs: 2 };
    expect(showsStockCheckButton({ isKanban: false, stockCounted: false, standingOrder })).toBe(false);
    expect(showsStockCheckButton({ isKanban: false, stockCounted: true, standingOrder })).toBe(true);
  });
});

describe("the last stock check on Orders", () => {
  const now = new Date("2026-11-05T09:00:00Z");

  it("says when it was, in London time", () => {
    expect(lastCheckWhen("2026-11-04T14:05:00Z", now)).toBe("Yesterday 14:05");
    expect(lastCheckWhen("2026-11-02T08:30:00Z", now)).toBe("Mon 2 Nov 08:30");
    expect(lastCheckWhen("2026-10-12T13:05:00Z", now)).toBe("Mon 12 Oct 14:05");
  });

  it("shows the value that was counted", () => {
    expect(lastCheckValue(e, "kg")).toBe("3 kg");
  });

  it("orders from the count plus what's been delivered, without taking off usage", () => {
    expect(stockFromLastCheck(e)).toBe(15.5);
    expect(deliveredSinceLabel(e, "kg")).toBe("+12.5 kg delivered since");
  });

  it("says nothing about deliveries when there haven't been any", () => {
    const none = { ...e, receiptsSince: 0 };
    expect(stockFromLastCheck(none)).toBe(3);
    expect(deliveredSinceLabel(none, "kg")).toBeNull();
  });

  it("never goes below nothing, e.g. after an undone delivery", () => {
    expect(stockFromLastCheck({ ...e, basedOnCountQty: 1, receiptsSince: -5 })).toBe(0);
  });

  it("is offered only on lines nobody has counted today", () => {
    expect(canUseLastCheck({ stockBasis: "expected", expectedStock: e, stockDirty: false })).toBe(true);
    expect(canUseLastCheck({ stockBasis: "count", expectedStock: e, stockDirty: false })).toBe(false);
    expect(canUseLastCheck({ stockBasis: "expected", expectedStock: null, stockDirty: false })).toBe(false);
    expect(canUseLastCheck({ stockBasis: "expected", expectedStock: e, stockDirty: true })).toBe(false);
    expect(canUseLastCheck({ stockBasis: "expected", expectedStock: e, stockDirty: true, usingLastCheck: true })).toBe(false);
  });

  it("keeps the blue button: using the last check isn't a count", () => {
    expect(stockBoxStartsBlank({ stockBasis: "expected", stockDirty: true, usingLastCheck: true })).toBe(true);
    expect(shouldSaveStockOnBlur({ stockBasis: "expected", stockDirty: true, usingLastCheck: true })).toBe(false);
  });
});
