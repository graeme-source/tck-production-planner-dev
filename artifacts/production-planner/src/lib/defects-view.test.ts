import { describe, it, expect } from "vitest";
import { barWidth, formTypeOrder, reasonDetailValid, reasonText, dayText, defectHeadline, gbpText, minutesText, orderRefList, parseAmount, pctText, quantityText, rangeText, recordItemName, stationText } from "./defects-view";

describe("defectHeadline", () => {
  it("reads as defects · % of packs made", () => {
    expect(defectHeadline({ defects: 14, packsMade: 1180, pct: 1.2 })).toBe("14 defects · 1.2% of 1,180 packs");
    expect(defectHeadline({ defects: 1, packsMade: 1, pct: 100 })).toBe("1 defect · 100.0% of 1 pack");
  });
  it("never shows 0% when nothing was made", () => {
    expect(defectHeadline({ defects: 8, packsMade: 0, pct: null })).toBe("8 defects · no packs made");
    expect(pctText(null)).toBe("—");
  });
});

describe("labels", () => {
  it("station keys become names; unknown text is shown as typed", () => {
    expect(stationText("wrapping", { wrapping: "Wrapping" })).toBe("Wrapping");
    expect(stationText("Despatch bench", {})).toBe("Despatch bench");
    expect(stationText(null, {})).toBe("Not recorded");
  });
  it("days and ranges", () => {
    expect(dayText("2026-09-30", "2026-10-01")).toMatch(/^Wed 30 Sept?$/); // ICU versions differ on "Sep" / "Sept"
    expect(dayText("2025-12-31", "2026-10-01")).toContain("2025");
    expect(rangeText("2026-10-01", "2026-10-01", "2026-10-01")).toBe("Thu 1 Oct");
  });
  it("order refs are split and given a #", () => {
    expect(orderRefList("#136117, 136112")).toEqual(["#136117", "#136112"]);
    expect(orderRefList(null)).toEqual([]);
  });
  it("bars", () => {
    expect(barWidth(0, 10)).toBe(0);
    expect(barWidth(10, 10)).toBe(100);
    expect(barWidth(1, 1000)).toBe(4);
  });
});

describe("waste wording", () => {
  it("shows £ to the penny, — when unpriced", () => {
    expect(gbpText(13.62)).toBe("£13.62");
    expect(gbpText(null)).toBe("—");
  });
  it("reads minutes as hours and minutes", () => {
    expect(minutesText(45)).toBe("45 min");
    expect(minutesText(90)).toBe("1 h 30 min");
    expect(minutesText(120)).toBe("2 h");
  });
  it("describes the amount", () => {
    expect(quantityText({ quantity: 2.3, quantityUnit: "kg", packKind: null })).toBe("2.3 kg");
    expect(quantityText({ quantity: 3, quantityUnit: "pack", packKind: "pack" }, "2-pack")).toBe("3 × 2-pack");
    expect(quantityText({ quantity: 1, quantityUnit: "bag", packKind: "eight_pack_bag" })).toBe("1 × 8-pack bag");
    expect(quantityText({ quantity: null, quantityUnit: null, packKind: null })).toBeNull();
  });
  it("names the item, falling back to an older record's recipe", () => {
    expect(recordItemName({ itemName: "Nacho Cheese Block v4", recipeName: null })).toBe("Nacho Cheese Block v4");
    expect(recordItemName({ itemName: null, recipeName: "A recipe" })).toBe("A recipe");
  });
});

describe("parseAmount", () => {
  it("reads decimals with a point or a comma", () => {
    expect(parseAmount("2.3")).toBe(2.3);
    expect(parseAmount(" 2,3 ")).toBe(2.3);
    expect(parseAmount("500")).toBe(500);
    expect(parseAmount(".5")).toBe(0.5);
  });
  it("refuses blanks, zero, words and (for packs) fractions", () => {
    for (const t of ["", "0", "abc", "-1", "1e3", "2.3.4"]) expect(parseAmount(t)).toBeNull();
    expect(parseAmount("1.5", true)).toBeNull();
    expect(parseAmount("3", true)).toBe(3);
  });
});

// Regression (Graeme, 2026-10-21): no reason fitted "wrong recipe made, extra
// dough binned", and there was no way to type one.
describe("reasons — new types and 'Something else…'", () => {
  const types = [
    { id: 1, name: "Mislabel", sortOrder: 10 },
    { id: 9, name: "Something else", sortOrder: 80, asksForDetail: true },
    { id: 6, name: "Made wrong / wrong recipe", sortOrder: 60 },
    { id: 7, name: "Made too much / overproduced", sortOrder: 70 },
    { id: 8, name: "Weighing mistake / inaccurate recipe", sortOrder: 75 },
    { id: 10, name: "Added later by an admin", sortOrder: 90 },
  ];
  it("lists the new reasons by sort order and 'Something else' last, even after admin-added types", () => {
    expect(formTypeOrder(types).map(t => t.name)).toEqual([
      "Mislabel", "Made wrong / wrong recipe", "Made too much / overproduced",
      "Weighing mistake / inaccurate recipe", "Added later by an admin", "Something else",
    ]);
  });
  it("labels: an ordinary reason is its name; 'Something else' shows what was typed", () => {
    expect(reasonText({ typeName: "Weighing mistake / inaccurate recipe", reasonOther: null })).toBe("Weighing mistake / inaccurate recipe");
    expect(reasonText({ typeName: "Made too much / overproduced", reasonOther: null })).toBe("Made too much / overproduced");
    expect(reasonText({ typeName: "Something else", reasonOther: "wrong recipe — extra dough made" }))
      .toBe("Something else: wrong recipe — extra dough made");
    expect(reasonText({ typeName: "Something else", reasonOther: "  " })).toBe("Something else");
  });
  it("typed reason needs 3–200 characters", () => {
    expect(reasonDetailValid("ab")).toBe(false);
    expect(reasonDetailValid("   ")).toBe(false);
    expect(reasonDetailValid("extra dough")).toBe(true);
    expect(reasonDetailValid("x".repeat(201))).toBe(false);
  });
});
