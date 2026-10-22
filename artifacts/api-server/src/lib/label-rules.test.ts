import { describe, it, expect } from "vitest";
import {
  resolveOpenedLife,
  parseCategoryDefaults,
  addDaysIso,
} from "./label-rules";

describe("resolveOpenedLife", () => {
  const defaults = { raw_meat: 2, cheese: 3 };

  it("the ingredient's own number wins", () => {
    expect(resolveOpenedLife({ openedLifeDays: 5, category: "cheese" }, defaults))
      .toEqual({ days: 5, source: "ingredient" });
  });

  it("falls back to the category default", () => {
    expect(resolveOpenedLife({ openedLifeDays: null, category: "cheese" }, defaults))
      .toEqual({ days: 3, source: "category" });
  });

  it("no rule means no label — there is no fallback date", () => {
    expect(resolveOpenedLife({ openedLifeDays: null, category: "vegetable" }, defaults)).toBeNull();
    expect(resolveOpenedLife({ openedLifeDays: null, category: null }, defaults)).toBeNull();
    expect(resolveOpenedLife({ openedLifeDays: 0, category: "vegetable" }, defaults)).toBeNull();
  });

  it("zero or negative overrides are ignored, not printed", () => {
    expect(resolveOpenedLife({ openedLifeDays: 0, category: "cheese" }, defaults)?.days).toBe(3);
    expect(resolveOpenedLife({ openedLifeDays: -1, category: "cheese" }, defaults)?.days).toBe(3);
  });

});

describe("parseCategoryDefaults", () => {
  it("parses a normal settings blob", () => {
    expect(parseCategoryDefaults('{"raw_meat":2,"cheese":3}')).toEqual({ raw_meat: 2, cheese: 3 });
  });

  it("drops junk values instead of letting them near a use-by date", () => {
    expect(parseCategoryDefaults('{"cheese":"3","sauce":0,"dough":-2,"pasta":"soon"}')).toEqual({ cheese: 3 });
  });

  it("bad JSON or wrong shape degrades to no defaults, never a crash", () => {
    expect(parseCategoryDefaults("not json")).toEqual({});
    expect(parseCategoryDefaults("[1,2]")).toEqual({});
    expect(parseCategoryDefaults(null)).toEqual({});
  });

  it("fractional days floor down — 2.9 days is 2, not 3", () => {
    expect(parseCategoryDefaults('{"cheese":2.9}')).toEqual({ cheese: 2 });
  });
});

describe("addDaysIso", () => {
  it("adds across month ends", () => {
    expect(addDaysIso("2026-09-30", 2)).toBe("2026-10-02");
  });
  it("adds zero as identity", () => {
    expect(addDaysIso("2026-09-08", 0)).toBe("2026-09-08");
  });
});
