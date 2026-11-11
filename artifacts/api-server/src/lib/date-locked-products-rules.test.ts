import { describe, it, expect } from "vitest";
import { lockedLines, lockedReason, LOCKED_TITLE_PATTERNS } from "./date-locked-products-rules";

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
