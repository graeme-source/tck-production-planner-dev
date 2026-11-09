import { describe, expect, it } from "vitest";
import { bookButtonLabel, defaultSelection } from "./apc-book-selection";

describe("defaultSelection", () => {
  it("ticks every ready order when the modal opens", () => {
    expect([...defaultSelection([{ orderId: 1 }, { orderId: 2 }])]).toEqual([1, 2]);
    expect(defaultSelection([]).size).toBe(0);
  });
});

describe("bookButtonLabel", () => {
  it("says Book all when every ready order is ticked, like Tag all", () => {
    expect(bookButtonLabel([1, 2, 3], [1, 2, 3])).toBe("Book all 3");
  });

  it("says how many for a smaller pick", () => {
    expect(bookButtonLabel([1, 2], [1, 2, 3])).toBe("Book 2");
  });

  it("doesn't call it all when a 'needs a look' order is ticked instead of a ready one", () => {
    expect(bookButtonLabel([1, 2, 9], [1, 2, 3])).toBe("Book 3");
  });

  it("has nothing to count with nothing ticked", () => {
    expect(bookButtonLabel([], [1])).toBe("Book");
  });
});
