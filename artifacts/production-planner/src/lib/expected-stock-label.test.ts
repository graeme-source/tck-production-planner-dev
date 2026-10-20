import { describe, expect, it } from "vitest";
import {
  expectedAtCountLabel,
  expectedStockBasisLine,
  expectedStockHeadline,
  expectedStockTooltip,
  shouldSaveStockOnBlur,
  showsStockCheckButton,
  stockBoxStartsBlank,
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
});
