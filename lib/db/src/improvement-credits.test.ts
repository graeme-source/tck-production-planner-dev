import { describe, it, expect } from "vitest";
import {
  normaliseCreditIds, mergeCredits, withLead, formatCreditNames, isCredited, MAX_CREDITED_PEOPLE,
} from "./improvement-credits";

describe("normaliseCreditIds", () => {
  it("keeps first-mention order and drops duplicates", () => {
    expect(normaliseCreditIds([3, 7, 3, 9, 7])).toEqual([3, 7, 9]);
  });

  it("drops anything that isn't a positive integer id", () => {
    expect(normaliseCreditIds([0, -2, 1.5, NaN, null, undefined, "x", {}, 4])).toEqual([4]);
  });

  it("accepts numeric strings (form values)", () => {
    expect(normaliseCreditIds(["12", " ", "5"])).toEqual([12, 5]);
  });

  it("returns empty for nobody, so the caller can refuse it", () => {
    expect(normaliseCreditIds([])).toEqual([]);
    expect(normaliseCreditIds([0, -1])).toEqual([]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 50 }, (_, i) => i + 1);
    expect(normaliseCreditIds(many)).toHaveLength(MAX_CREDITED_PEOPLE);
  });
});

describe("mergeCredits", () => {
  it("puts the lead first, then the rows, each person once", () => {
    const out = mergeCredits(
      { userId: 1, name: "Graeme" },
      [{ userId: 1, name: "Graeme" }, { userId: 2, name: "Bodan" }],
    );
    expect(out).toEqual([{ userId: 1, name: "Graeme" }, { userId: 2, name: "Bodan" }]);
  });

  it("still credits a lead that has no row (a writer that only set credited_to)", () => {
    expect(mergeCredits({ userId: 5, name: "Lorna" }, [])).toEqual([{ userId: 5, name: "Lorna" }]);
  });

  it("uses the rows alone when there's no lead", () => {
    expect(mergeCredits({ userId: null, name: null }, [{ userId: 2, name: "Bodan" }]))
      .toEqual([{ userId: 2, name: "Bodan" }]);
  });

  it("is empty when nobody is credited yet", () => {
    expect(mergeCredits({ userId: null, name: null }, [])).toEqual([]);
  });

  it("fills a missing lead name from the row", () => {
    expect(mergeCredits({ userId: 1, name: null }, [{ userId: 1, name: "Graeme" }]))
      .toEqual([{ userId: 1, name: "Graeme" }]);
  });
});

describe("withLead", () => {
  it("moves an existing person to the front without dropping anyone", () => {
    expect(withLead([1, 2, 3], 3)).toEqual([3, 1, 2]);
  });

  it("adds a new lead in front of the existing people", () => {
    expect(withLead([1, 2], 9)).toEqual([9, 1, 2]);
  });

  it("leaves the list alone for no lead", () => {
    expect(withLead([1, 2], null)).toEqual([1, 2]);
  });
});

describe("formatCreditNames", () => {
  it("reads naturally for one, two and three people", () => {
    expect(formatCreditNames(["Graeme"])).toBe("Graeme");
    expect(formatCreditNames(["Graeme", "Bodan"])).toBe("Graeme & Bodan");
    expect(formatCreditNames(["Graeme", "Bodan", "Lorna"])).toBe("Graeme, Bodan & Lorna");
  });

  it("skips blank names and returns null for nobody", () => {
    expect(formatCreditNames([null, " ", "Bodan"])).toBe("Bodan");
    expect(formatCreditNames([])).toBeNull();
    expect(formatCreditNames([null, undefined])).toBeNull();
  });
});

describe("isCredited", () => {
  const credits = [{ userId: 1, name: "Graeme" }, { userId: 2, name: "Bodan" }];
  it("is true for every credited person, not just the first", () => {
    expect(isCredited(credits, 1)).toBe(true);
    expect(isCredited(credits, 2)).toBe(true);
  });
  it("is false for anyone else or no viewer", () => {
    expect(isCredited(credits, 3)).toBe(false);
    expect(isCredited(credits, null)).toBe(false);
    expect(isCredited(credits, undefined)).toBe(false);
  });
});
