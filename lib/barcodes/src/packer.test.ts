import { describe, expect, it } from "vitest";
import {
  canTickByHand, decideScan, linesNeedingBarcode, needsBarcodeMessage, planPackerBarcode,
  type BarcodeHolder, type ScanLine,
} from "./index";

// Regression (Graeme, 12 Oct 2026): with "Allow manual tap to pick" OFF the
// packing screen still let a line with no barcode be ticked by hand.

describe("ticking by hand needs the manual setting", () => {
  it("is refused when the setting is off — barcode or not", () => {
    expect(canTickByHand(false)).toBe(false);
  });
  it("is allowed when the setting is on", () => {
    expect(canTickByHand(true)).toBe(true);
  });
});

describe("server completion gate — lines with no barcode", () => {
  const lines = [
    { variantId: "11", name: "Godfather · 2 Pack" },
    { variantId: "22", name: "Order Insert" },
    { variantId: "22", name: "Order Insert" },
    { variantId: null, name: "Custom item" },
  ];
  const barcodeOf = (id: string) => (id === "11" ? "5065018206054" : null);

  it("refuses an order with a no-barcode line when the setting is off", () => {
    const blocked = linesNeedingBarcode(lines, barcodeOf, false);
    expect(blocked.map(l => l.name)).toEqual(["Order Insert", "Custom item"]);
    expect(needsBarcodeMessage(blocked)).toContain("Order Insert, Custom item have no barcode");
  });
  it("lets it through when the setting is on (behaviour unchanged)", () => {
    expect(linesNeedingBarcode(lines, barcodeOf, true)).toEqual([]);
  });
  it("lets it through when every line has a barcode", () => {
    expect(linesNeedingBarcode([lines[0]], barcodeOf, false)).toEqual([]);
  });
});

describe("typed SKU/title can't tick a no-barcode line with the setting off", () => {
  const line = (key: string, barcode: string | null, sku: string): ScanLine =>
    ({ key, barcode, identityKey: `id-${key}`, name: key, sku, title: key, remaining: 1 });
  const lines = [line("Insert", null, "INS"), line("Godfather", "5065018206054", "GF")];

  it("off: refused for the no-barcode line, still works for a barcoded one", () => {
    expect(decideScan("INS", lines, {}, { manualTick: false })).toEqual({ kind: "no-match" });
    expect(decideScan("GF", lines, {}, { manualTick: false })).toEqual({ kind: "tick", key: "Godfather" });
  });
  it("on: unchanged", () => {
    expect(decideScan("INS", lines, {}, { manualTick: true })).toEqual({ kind: "tick", key: "Insert" });
    expect(decideScan("INS", lines, {})).toEqual({ kind: "tick", key: "Insert" });
  });
});

describe("a packer setting a barcode for a product with none", () => {
  const holder = (h: Partial<BarcodeHolder>): BarcodeHolder => ({
    variantId: "9", name: "x", identityKey: "other", identityName: "The Godfather · 2-pack", current: true, ours: null, shopify: null, ...h,
  });
  const target = { identityKey: "insert", name: "Order Insert", existing: null };

  it("accepts a valid number nobody else has", () => {
    expect(planPackerBarcode("5065018206207", target, [holder({ ours: "5065018206054" })]))
      .toEqual({ ok: true, digits: "5065018206207", format: "EAN-13" });
  });
  it("refuses a number linked to a different product, naming it", () => {
    const r = planPackerBarcode("5065018206054", target, [holder({ ours: "5065018206054" })]);
    expect(r).toMatchObject({ ok: false, why: "elsewhere", product: "The Godfather · 2-pack" });
    if (!r.ok) expect(r.reason).toContain("fetch a manager");
  });
  it("refuses a number a retired product or Shopify still carries", () => {
    expect(planPackerBarcode("5065018206054", target, [holder({ current: false, ours: null, shopify: "5065018206054" })]))
      .toMatchObject({ ok: false, why: "elsewhere" });
  });
  it("allows a number another listing of the SAME product holds", () => {
    expect(planPackerBarcode("5065018206054", target, [holder({ identityKey: "insert", ours: "5065018206054" })]))
      .toMatchObject({ ok: true });
  });
  it("refuses when the product already has a barcode — changing it is manager-only", () => {
    const r = planPackerBarcode("5065018206207", { ...target, existing: "5065018206054" }, []);
    expect(r).toMatchObject({ ok: false, why: "has-barcode" });
    if (!r.ok) expect(r.reason).toContain("Only a manager");
  });
  it("refuses a bad check digit", () => {
    expect(planPackerBarcode("5065018206055", target, [])).toMatchObject({ ok: false, why: "invalid" });
  });
});
