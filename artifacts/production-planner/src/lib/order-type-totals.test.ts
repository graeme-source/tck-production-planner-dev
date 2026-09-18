import { describe, it, expect } from "vitest";
import { countForTags, revenueForTags, type TagGroup } from "./order-type-totals";

const RECURRING = "Subscription Recurring Order";
const NEW_SUB = "Subscription New Order";

const groups: TagGroup[] = [
  { tag: "new-customer", orders: [{ id: 1, total: 40 }, { id: 2, total: 60 }] },
  { tag: RECURRING, orders: [{ id: 10, total: 25 }, { id: 11, total: 35 }] },
  { tag: NEW_SUB, orders: [{ id: 20, total: 50 }] },
  { tag: "wholesale", orders: [{ id: 30, total: 900 }] },
];

describe("revenueForTags", () => {
  it("sums a single tag", () => {
    expect(revenueForTags(groups, ["new-customer"])).toBe(100);
  });

  it("combines the two subscription tags", () => {
    expect(revenueForTags(groups, [RECURRING, NEW_SUB])).toBe(110);
  });

  it("counts an order carrying both tags only once", () => {
    const overlapping: TagGroup[] = [
      { tag: RECURRING, orders: [{ id: 10, total: 25 }] },
      { tag: NEW_SUB, orders: [{ id: 10, total: 25 }, { id: 20, total: 50 }] },
    ];
    expect(revenueForTags(overlapping, [RECURRING, NEW_SUB])).toBe(75);
  });

  it("ignores tags that aren't asked for", () => {
    expect(revenueForTags(groups, [RECURRING, NEW_SUB])).not.toContain(900);
    expect(revenueForTags(groups, ["wholesale"])).toBe(900);
  });

  it("is 0 for a tag with no orders, not null", () => {
    expect(revenueForTags(groups, ["nothing-here"])).toBe(0);
  });

  it("is null — not 0 — when the groups haven't loaded", () => {
    expect(revenueForTags(undefined, [RECURRING])).toBeNull();
  });

  it("treats a missing or non-numeric total as 0 rather than NaN", () => {
    const messy: TagGroup[] = [
      { tag: RECURRING, orders: [{ id: 1, total: null }, { id: 2 }, { id: 3, total: 10 }] },
    ];
    expect(revenueForTags(messy, [RECURRING])).toBe(10);
  });

  it("survives a group with no orders array", () => {
    const odd = [{ tag: RECURRING }] as unknown as TagGroup[];
    expect(revenueForTags(odd, [RECURRING])).toBe(0);
  });
});

describe("countForTags", () => {
  it("counts distinct orders across both subscription tags", () => {
    expect(countForTags(groups, [RECURRING, NEW_SUB])).toBe(3);
  });

  it("does not double-count an order in both tags", () => {
    const overlapping: TagGroup[] = [
      { tag: RECURRING, orders: [{ id: 10, total: 25 }] },
      { tag: NEW_SUB, orders: [{ id: 10, total: 25 }] },
    ];
    expect(countForTags(overlapping, [RECURRING, NEW_SUB])).toBe(1);
  });

  it("is null when the groups haven't loaded", () => {
    expect(countForTags(undefined, [RECURRING])).toBeNull();
  });
});
