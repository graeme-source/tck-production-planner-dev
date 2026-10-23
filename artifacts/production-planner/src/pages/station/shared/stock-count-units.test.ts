import { describe, expect, it } from "vitest";
import { parseStockAmount, sanityMessage, stockCountSanity } from "./stock-count-units";

const basil = { unit: "g", packWeight: 100 };
const chicken = { unit: "kg", packWeight: 2.5 };

describe("stockCountSanity", () => {
  const recent = [200, 300, 200, 30, 300];
  it("is happy with a normal count, and with zero", () => {
    expect(stockCountSanity({ nativeQty: 500, recentNative: recent }).level).toBe("ok");
    expect(stockCountSanity({ nativeQty: 0, recentNative: recent }).level).toBe("ok");
  });
  it("asks about a count under a fifth of usual (5 g of basil)", () => {
    const s = stockCountSanity({ nativeQty: 5, recentNative: recent });
    expect(s).toMatchObject({ level: "warn", direction: "low", basis: "recent", typicalNative: 200 });
    expect(sanityMessage(s, { value: 5, unit: "g", item: basil }))
      .toBe("Are you sure — 5 g? That's a lot less than usual — count again to be sure.");
  });
  it("asks about a count over 5× usual, in the unit typed (Graeme: 'Are you sure — 5,500 g?')", () => {
    const s = stockCountSanity({ nativeQty: 5500, recentNative: [550, 600, 500] });
    expect(s).toMatchObject({ level: "warn", direction: "high" });
    expect(sanityMessage(s, { value: 5500, unit: "g", item: basil }))
      .toBe("Are you sure — 5,500 g? That's a lot more than usual — count again to be sure.");
  });
  it("never shows the usual figure — counts stay blind (Graeme, 23 Oct)", () => {
    // Chicken stored in kg, counted (by a manager's choice) in grams.
    const s = stockCountSanity({ nativeQty: 124, recentNative: [12, 13, 11] });
    const msg = sanityMessage(s, { value: 124000, unit: "g", item: chicken })!;
    expect(msg).toBe("Are you sure — 124,000 g? That's a lot more than usual — count again to be sure.");
    expect(msg).not.toMatch(/12,000|12 kg|usually about/);
  });
  it("falls back to 5× today's plan need only when there's no history", () => {
    expect(stockCountSanity({ nativeQty: 600, recentNative: [], planNeedNative: 100 })).toMatchObject({ level: "warn", basis: "plan" });
    expect(stockCountSanity({ nativeQty: 400, recentNative: [], planNeedNative: 100 }).level).toBe("ok");
    expect(stockCountSanity({ nativeQty: 600, recentNative: recent, planNeedNative: 100 }).level).toBe("ok");
  });
  it("says nothing when the count is fine", () => {
    expect(sanityMessage({ level: "ok" }, { value: 550, unit: "g", item: basil })).toBeNull();
  });
});

describe("parseStockAmount", () => {
  it("accepts numbers, thousands commas and a comma decimal; rejects junk", () => {
    expect(parseStockAmount("550")).toBe(550);
    expect(parseStockAmount("12.4")).toBe(12.4);
    expect(parseStockAmount("5,500")).toBe(5500);
    expect(parseStockAmount("2,5")).toBe(2.5);
    expect(parseStockAmount("0")).toBe(0);
    expect(parseStockAmount("")).toBeNull();
    expect(parseStockAmount("-3")).toBeNull();
    expect(parseStockAmount("abc")).toBeNull();
  });
});
