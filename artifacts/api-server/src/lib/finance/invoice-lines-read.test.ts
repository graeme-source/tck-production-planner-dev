import { describe, expect, it } from "vitest";
import { invoiceLinesPrompt, invoicePricePerOurPack, normaliseInvoiceLines, priceDiffers } from "./invoice-lines-read";

describe("normaliseInvoiceLines", () => {
  const ids = new Map([[250, "each"], [240, "each"], [22, "kg"]]);
  it("keeps goods and charges, drops unknown ingredient ids", () => {
    const lines = normaliseInvoiceLines({
      lines: [
        { code: "TGP500", description: "Gel pack 500g x36", quantity: 50, unit: "box", unit_price: 7.52, line_total: 376, is_charge: false, ingredient_id: 250, native_per_unit: 36 },
        { code: null, description: "Freight", quantity: 1, unit: null, unit_price: 61.5, line_total: 61.5, is_charge: true, ingredient_id: 250, native_per_unit: 1 },
        { code: "X", description: "Something else", quantity: "2", unit: "each", unit_price: "£1,000.50", line_total: null, is_charge: false, ingredient_id: 999, native_per_unit: 1 },
        { description: "  " },
      ],
    }, ids);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ position: 1, ingredientId: 250, nativePerUnit: 36, lineTotal: 376 });
    expect(lines[1]).toMatchObject({ isCharge: true, ingredientId: null, nativePerUnit: null });
    expect(lines[2]).toMatchObject({ ingredientId: null, quantity: 2, unitPrice: 1000.5 });
  });
  it("single items invoiced as single items are 1, never our pack size (Macfarlane boxes)", () => {
    const [l] = normaliseInvoiceLines({ lines: [{ code: "CPDW-0201", description: "Small Box", quantity: 360, unit: "each", unit_price: 0.64, line_total: 230.4, is_charge: false, ingredient_id: 240, native_per_unit: 360 }] }, ids);
    expect(l.nativePerUnit).toBe(1);
    const [k] = normaliseInvoiceLines({ lines: [{ code: null, description: "Pork", quantity: 19.49, unit: "kg", unit_price: 6.5, line_total: 114.02, is_charge: false, ingredient_id: 22, native_per_unit: 1 }] }, ids);
    expect(k.nativePerUnit).toBe(1);
  });
  it("copes with nonsense", () => {
    expect(normaliseInvoiceLines(null, ids)).toEqual([]);
    expect(normaliseInvoiceLines({ lines: "no" }, ids)).toEqual([]);
  });
});

describe("invoicePricePerOurPack", () => {
  it("Thergis: 50 boxes of 36 at £376 is £7.52 for our box of 36", () => {
    expect(invoicePricePerOurPack({ lineTotal: 376, quantity: 50, nativePerUnit: 36 }, 36)).toBeCloseTo(7.52, 4);
  });
  it("Macfarlane: 360 boxes at 64p is £230.40 for our pack of 360", () => {
    expect(invoicePricePerOurPack({ lineTotal: 230.4, quantity: 360, nativePerUnit: 1 }, 360)).toBeCloseTo(230.4, 4);
  });
  it("Best Butcher: pork 19.49 kg less 10% works out per kg", () => {
    expect(invoicePricePerOurPack({ lineTotal: 114.02, quantity: 19.49, nativePerUnit: 1 }, 1)).toBeCloseTo(5.85, 2);
  });
  it("Puffin: 1,200 liners at 74p is £148 for our box of 200 (regression: the 2-for-1 goods-in count doubled it)", () => {
    expect(invoicePricePerOurPack({ lineTotal: 888, quantity: 1200, nativePerUnit: 1 }, 200)).toBeCloseTo(148, 4);
    expect(invoicePricePerOurPack({ lineTotal: 888, quantity: 1200, nativePerUnit: 1 }, 0)).toBeCloseTo(0.74, 4);
  });
  it("null when it can't be worked out", () => {
    expect(invoicePricePerOurPack({ lineTotal: 10, quantity: null, nativePerUnit: 1 }, 1)).toBeNull();
    expect(invoicePricePerOurPack({ lineTotal: 10, quantity: 1, nativePerUnit: null }, 1)).toBeNull();
  });
});

describe("priceDiffers", () => {
  it("ignores pennies, catches real rises and missing prices", () => {
    expect(priceDiffers(208.94, 209.5)).toBe(false);
    expect(priceDiffers(208.94, 230.4)).toBe(true);
    expect(priceDiffers(0, 1.48)).toBe(true);
    expect(priceDiffers(5, 0)).toBe(false);
  });
});

describe("invoiceLinesPrompt", () => {
  it("lists our items with pack sizes and supplier codes", () => {
    const p = invoiceLinesPrompt("Thergis", [{ id: 250, name: "Ice (Gel pack 500g)", unit: "each", packWeight: 36, packName: "box", partNumber: "TGP500" }]);
    expect(p).toContain('id 250: Ice (Gel pack 500g) (counted in each, bought in a box of 36 each, supplier code "TGP500")');
  });
});
