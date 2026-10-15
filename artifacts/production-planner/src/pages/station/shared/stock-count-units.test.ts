import { describe, expect, it } from "vitest";
import {
  describePackCount,
  nativeExample,
  packCountToNative,
  packLabel,
  parseStockAmount,
  sanityMessage,
  stockCountMode,
  stockCountSanity,
} from "./stock-count-units";

const basil = { unit: "g", packWeight: 100 };
const flour = { unit: "kg", packWeight: "16.0000" };
const oil = { unit: "l", packWeight: 5 };
const onions = { unit: "kg", packWeight: null };

describe("stockCountMode", () => {
  it("counts packs when there's a pack size, one amount otherwise", () => {
    expect(stockCountMode(basil)).toBe("packs");
    expect(stockCountMode(flour)).toBe("packs");
    expect(stockCountMode(onions)).toBe("native");
    expect(stockCountMode({ unit: "g", packWeight: 0 })).toBe("native");
  });
  it("labels the pack by its size", () => {
    expect(packLabel(basil)).toBe("100g pack");
    expect(packLabel(oil)).toBe("5 L bottle");
  });
});

describe("packCountToNative", () => {
  it("adds full packs and the opened fraction in the ingredient's own unit", () => {
    expect(packCountToNative(3, { kind: "fraction", fraction: 0.5 }, basil)).toBe(350);
    expect(packCountToNative(5, { kind: "fraction", fraction: 0 }, basil)).toBe(500);
    expect(packCountToNative(2, { kind: "fraction", fraction: 0.25 }, flour)).toBe(36);
  });
  it("weighs an odd opened amount in grams and converts it", () => {
    expect(packCountToNative(1, { kind: "custom", amount: 40 }, basil)).toBe(140);
    expect(packCountToNative(1, { kind: "custom", amount: 2500 }, flour)).toBe(18.5);
  });
  it("refuses without a pack size or with bad numbers", () => {
    expect(packCountToNative(1, { kind: "fraction", fraction: 0 }, onions)).toBeNull();
    expect(packCountToNative(-1, { kind: "fraction", fraction: 0 }, basil)).toBeNull();
  });
});

describe("describePackCount", () => {
  it("reads back in plain words", () => {
    expect(describePackCount(3, { kind: "fraction", fraction: 0.5 }, basil)).toBe("3 full packs + ½ a pack = 350 g");
    expect(describePackCount(1, { kind: "fraction", fraction: 0 }, basil)).toBe("1 full pack = 100 g");
    expect(describePackCount(0, { kind: "fraction", fraction: 0.75 }, basil)).toBe("¾ a pack = 75 g");
    expect(describePackCount(2, { kind: "custom", amount: 40 }, basil)).toBe("2 full packs + an opened pack of 40 g = 240 g");
    expect(describePackCount(0, { kind: "fraction", fraction: 0 }, basil)).toBe("Nothing left = 0 g");
    expect(describePackCount(2, { kind: "fraction", fraction: 0.5 }, flour)).toBe("2 full packs + ½ a pack = 40.000 kg");
  });
});

describe("nativeExample", () => {
  it("gives a sensible example per unit", () => {
    expect(nativeExample("kg")).toBe("e.g. 2.5");
    expect(nativeExample("g")).toBe("e.g. 250");
  });
});

describe("stockCountSanity", () => {
  const recent = [200, 300, 200, 30, 300];
  it("is happy with a normal count, and with zero", () => {
    expect(stockCountSanity({ nativeQty: 500, recentNative: recent }).level).toBe("ok");
    expect(stockCountSanity({ nativeQty: 0, recentNative: recent }).level).toBe("ok");
  });
  it("asks about a count under a fifth of usual (5 g of basil)", () => {
    const s = stockCountSanity({ nativeQty: 5, recentNative: recent });
    expect(s).toMatchObject({ level: "warn", direction: "low", basis: "recent", typicalNative: 200 });
    expect(sanityMessage(s, basil)).toBe("That's a lot less than usual (usually about 200 g) — check?");
  });
  it("asks about a count over 5× usual", () => {
    const s = stockCountSanity({ nativeQty: 1500, recentNative: recent });
    expect(s).toMatchObject({ level: "warn", direction: "high" });
    expect(sanityMessage(s, basil)).toBe("That's a lot more than usual (usually about 200 g) — check?");
  });
  it("falls back to 5× today's plan need only when there's no history", () => {
    expect(stockCountSanity({ nativeQty: 600, recentNative: [], planNeedNative: 100 })).toMatchObject({ level: "warn", basis: "plan" });
    expect(stockCountSanity({ nativeQty: 400, recentNative: [], planNeedNative: 100 }).level).toBe("ok");
    expect(stockCountSanity({ nativeQty: 600, recentNative: recent, planNeedNative: 100 }).level).toBe("ok");
  });
});

describe("parseStockAmount", () => {
  it("accepts numbers and a comma decimal, rejects junk", () => {
    expect(parseStockAmount("2,5")).toBe(2.5);
    expect(parseStockAmount("0")).toBe(0);
    expect(parseStockAmount("")).toBeNull();
    expect(parseStockAmount("-3")).toBeNull();
    expect(parseStockAmount("abc")).toBeNull();
  });
});
