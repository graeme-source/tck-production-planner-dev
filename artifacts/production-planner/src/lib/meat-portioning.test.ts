import { describe, expect, it } from "vitest";
import { displayUnits, portionWord, sharedContainer, wholeLotToggle } from "./meat-portioning";

describe("portionWord", () => {
  it("says bags for a bagged meat like pork, trays otherwise", () => {
    expect(portionWord("bag", 1)).toBe("bag");
    expect(portionWord("bag", 4)).toBe("bags");
    expect(portionWord("tray", 2)).toBe("trays");
    expect(portionWord(undefined, 1)).toBe("tray");
  });
});

describe("sharedContainer", () => {
  it("only says bag when every meat in the recipe is bagged", () => {
    expect(sharedContainer(["bag", "bag"])).toBe("bag");
    expect(sharedContainer(["bag", "tray"])).toBe("tray");
    expect(sharedContainer([])).toBe("tray");
  });
});

describe("wholeLotToggle", () => {
  it("ticks every portion still to do in one go", () => {
    expect(wholeLotToggle(4, n => n === 2)).toEqual({ action: "tick", numbers: [1, 3, 4] });
  });
  it("unticks them all when they're all done", () => {
    expect(wholeLotToggle(3, () => true)).toEqual({ action: "untick", numbers: [1, 2, 3] });
  });
  it("has nothing to do with no portions", () => {
    expect(wholeLotToggle(0, () => false)).toEqual({ action: "untick", numbers: [] });
  });
});

describe("displayUnits", () => {
  it("counts the portions of a split meat", () => {
    expect(displayUnits({ portions: 5, done: 2, breakdown: true })).toEqual({ total: 5, done: 2 });
  });
  it("counts an unsplit meat as one lot, done only when every portion is", () => {
    expect(displayUnits({ portions: 5, done: 0, breakdown: false })).toEqual({ total: 1, done: 0 });
    expect(displayUnits({ portions: 5, done: 4, breakdown: false })).toEqual({ total: 1, done: 0 });
    expect(displayUnits({ portions: 5, done: 5, breakdown: false })).toEqual({ total: 1, done: 1 });
  });
});
