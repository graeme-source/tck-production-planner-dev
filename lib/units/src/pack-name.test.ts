// #327: an ingredient's pack can be called what it is — box, roll, bag —
// wherever "pack" shows, and the stock check says exactly what to count.
import { describe, expect, it } from "vitest";
import { packNoun, pluralPackName, isPackName } from "./order-quantity";
import { describeStockCount, stockCheckInstruction, stockCheckPackLabel, stockCheckUnitSymbol } from "./stock-check-unit";

describe("packNoun with a pack name", () => {
  it("uses the pack's own name, singular and plural", () => {
    expect(packNoun("kg", 1, "box")).toBe("box");
    expect(packNoun("kg", 3, "box")).toBe("boxes");
    expect(packNoun("pieces", 2, "roll")).toBe("rolls");
    expect(packNoun("kg", 0, "case")).toBe("cases");
    expect(pluralPackName("tub")).toBe("tubs");
  });
  it("no name (or a name not on the list) keeps the old wording", () => {
    expect(packNoun("kg", 2)).toBe("packs");
    expect(packNoun("l", 1, null)).toBe("bottle");
    expect(packNoun("kg", 2, "Boxs")).toBe("packs");
    expect(isPackName("Boxs")).toBe(false);
  });
});

describe("stock check says exactly what to count", () => {
  const mozz = { unit: "kg", packWeight: 12, stockInPacks: true, packName: "box" };
  it("Count BOXES (1 box = 12 kg)", () => {
    expect(stockCheckInstruction("packs", mozz)).toEqual({ verb: "Count", what: "BOXES", detail: "1 box = 12 kg" });
    expect(stockCheckPackLabel("packs", mozz)).toBe("1 box = 12 kg");
    expect(stockCheckUnitSymbol("packs", mozz, 3)).toBe("boxes");
  });
  it("Weigh in KILOGRAMS", () => {
    expect(stockCheckInstruction("kg", { unit: "kg" })).toEqual({ verb: "Weigh in", what: "KILOGRAMS", detail: null });
  });
  it("read-back names the pack too; the stored amount is unchanged", () => {
    const d = describeStockCount(2, "packs", mozz);
    expect(d?.entered).toBe("2 boxes");
    expect(d?.native).toBe(24);
    const k = describeStockCount(30, "kg", mozz);
    expect(k?.extras).toContain("2.5 boxes of 12 kg");
  });
});
