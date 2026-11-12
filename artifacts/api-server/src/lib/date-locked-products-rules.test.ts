import { describe, it, expect } from "vitest";
import { lockedLines, lockedReason, LOCKED_TITLE_PATTERNS, safeToMoveCandidates } from "./date-locked-products-rules";

const list = { variantIds: ["59189396865398", "56785048502646"], titlePatterns: [...LOCKED_TITLE_PATTERNS] };

describe("date-locked products (11 Nov 2026)", () => {
  it("locks this week's test production by variant, though nothing says 'test'", () => {
    const lines = [
      { variant_id: 59189396865398, title: "Chicken & Bacon Pie Calzone", variant_title: "2 Pack" },
      { variant_id: 44993576534295, title: "BBQ Pulled Pork", variant_title: "2 Pack" },
    ];
    expect(lockedLines(lines, list).map(l => l.title)).toEqual(["Chicken & Bacon Pie Calzone"]);
    expect(lockedReason(lockedLines(lines, list))).toMatch(/made to order for this date .*Chicken & Bacon Pie Calzone/);
  });

  it("locks 8-pack bags by their variant title", () => {
    const lines = [{ variant_id: 45824296878359, title: "BBQ Pulled Pork", variant_title: "8 Pack Bag" }];
    expect(lockedLines(lines, list)).toHaveLength(1);
    expect(lockedReason(lockedLines(lines, list))).toMatch(/^8-pack bags are made to order/);
  });

  it("leaves an everyday order movable, and ignores lines removed by an edit", () => {
    expect(lockedLines([{ variant_id: 44993576534295, title: "BBQ Pulled Pork", variant_title: "2 Pack" }], list)).toEqual([]);
    expect(lockedLines([{ variant_id: 59189396865398, title: "Chicken & Bacon Pie Calzone", current_quantity: 0 }], list)).toEqual([]);
    expect(lockedLines(null, list)).toEqual([]);
  });

  it("still catches test boxes by name", () => {
    expect(lockedLines([{ variant_id: 1, title: "Winter Warmers Test Box" }], list)).toHaveLength(1);
  });
});

describe("safeToMoveCandidates", () => {
  const locked = {
    variantIds: ["31277638844497", "555"],
    titlePatterns: ["8 pack bag", "test box", "test pack"],
    products: { "31277638844497": { recipeId: 31, name: "TCK Garlic Mayo 200ml" }, "555": { recipeId: 42, name: "Beef & Mushroom" } },
  };

  // Graeme, 12 Nov 2026: Garlic Mayo locked #139579 though it's always in stock.
  it("offers the product behind a product-locked line, once", () => {
    const lines = [
      { variant_id: 31277638844497, title: "TCK Garlic Mayo" },
      { variant_id: "31277638844497", title: "TCK Garlic Mayo" },
    ];
    expect(safeToMoveCandidates(lines, locked)).toEqual([{ recipeId: 31, name: "TCK Garlic Mayo 200ml" }]);
  });

  it("never offers 8-pack bags or test boxes — those stay by hand", () => {
    const lines = [{ variant_id: 555, title: "Winter Warmers Test Box" }, { variant_id: 9, title: "Chicken 8 Pack Bag" }];
    expect(safeToMoveCandidates(lines, locked)).toEqual([]);
  });

  it("offers nothing without the product names (the assistant's copy of the list)", () => {
    expect(safeToMoveCandidates([{ variant_id: 555, title: "Beef" }], { variantIds: ["555"], titlePatterns: [] })).toEqual([]);
  });
});
