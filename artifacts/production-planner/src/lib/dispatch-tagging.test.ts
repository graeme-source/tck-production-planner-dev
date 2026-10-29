import { describe, it, expect } from "vitest";
import { boxCategoryOf, isDispatchTagged, ordersForTagging, passesLabelFilter } from "./dispatch-tagging";

const order = (id: number, tags: string) => ({ id, tags });

// The day as the packer actually sees it: a big pile of small boxes, one
// large, a couple of wholesale, and a handful already approved earlier.
const day = [
  order(1, "small box"),
  order(2, "small box"),
  order(3, "large box"),
  order(4, "wholesale"),
  order(5, "small box, dispatch"),
  order(6, "local-delivery"),
  order(7, ""),
];

describe("ordersForTagging", () => {
  // Regression: the tag button used to take its list from the pick filters
  // below it. A packer who had narrowed the list to Large tagged one order,
  // saw "1 order awaiting approval", and left the rest of the day untagged —
  // and untagged orders never get an APC label.
  it("defaults to every untagged order, whatever the pick list is showing", () => {
    expect(ordersForTagging(day, "all").map(o => o.id)).toEqual([1, 2, 3, 4, 6, 7]);
  });

  it("never re-tags an order that is already approved", () => {
    expect(ordersForTagging(day, "all").some(o => o.id === 5)).toBe(false);
    expect(ordersForTagging(day, "small box").map(o => o.id)).toEqual([1, 2]);
  });

  it("narrows to one box size when the scope is set", () => {
    expect(ordersForTagging(day, "large box").map(o => o.id)).toEqual([3]);
    expect(ordersForTagging(day, "wholesale").map(o => o.id)).toEqual([4]);
    expect(ordersForTagging(day, "local delivery").map(o => o.id)).toEqual([6]);
    expect(ordersForTagging(day, "other").map(o => o.id)).toEqual([7]);
  });

  it("returns nothing when the whole day is already tagged", () => {
    expect(ordersForTagging([order(8, "small box, dispatch")], "all")).toEqual([]);
  });
});

describe("boxCategoryOf", () => {
  it("puts local delivery ahead of box size — it goes on the van either way", () => {
    expect(boxCategoryOf(order(9, "large box, local-delivery"))).toBe("local delivery");
  });

  it("reads tags case- and space-insensitively, as Shopify returns them", () => {
    expect(boxCategoryOf(order(10, " Small Box , Dispatch "))).toBe("small box");
    expect(isDispatchTagged(order(10, " Small Box , Dispatch "))).toBe(true);
  });

  it("falls back to 'other' for an untagged order", () => {
    expect(boxCategoryOf(order(11, ""))).toBe("other");
  });
});

describe("passesLabelFilter — the packing bench's Labels row", () => {
  const local = { tags: "local-delivery, large box, dispatch" };
  const collection = { tags: "collection" };
  const wholesale = { tags: "wholesale, dispatch" };
  const small = { tags: "small box, dispatch" };

  it("No label / Booked only ever show courier orders", () => {
    expect(passesLabelFilter(small, "unbooked", false)).toBe(true);
    expect(passesLabelFilter(small, "booked", true)).toBe(true);
    expect(passesLabelFilter(wholesale, "unbooked", false)).toBe(true);
    // A local delivery never gets a label, so it is neither "No label" nor "Booked".
    expect(passesLabelFilter(local, "unbooked", false)).toBe(false);
    expect(passesLabelFilter(local, "booked", true)).toBe(false);
    expect(passesLabelFilter(collection, "unbooked", false)).toBe(false);
  });

  it("Local delivery, Collection and Wholesale narrow to that kind of order", () => {
    expect(passesLabelFilter(local, "local", false)).toBe(true);
    expect(passesLabelFilter(small, "local", true)).toBe(false);
    expect(passesLabelFilter(collection, "collection", false)).toBe(true);
    expect(passesLabelFilter(local, "collection", false)).toBe(false);
    expect(passesLabelFilter(wholesale, "wholesale", true)).toBe(true);
    expect(passesLabelFilter(small, "wholesale", true)).toBe(false);
  });
});
