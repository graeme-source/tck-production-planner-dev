import { describe, expect, it } from "vitest";
import { compareValues, nextSort, sortRows } from "./sortable-table";

describe("compareValues", () => {
  it("compares strings naturally and ignoring case", () => {
    expect(compareValues("apple", "Banana", "asc")).toBeLessThan(0);
    expect(compareValues("Item 2", "Item 10", "asc")).toBeLessThan(0);
    expect(compareValues("apple", "Banana", "desc")).toBeGreaterThan(0);
  });
  it("compares numbers numerically", () => {
    expect(compareValues(9, 10, "asc")).toBeLessThan(0);
    expect(compareValues(9, 10, "desc")).toBeGreaterThan(0);
  });
  it("puts blanks last in both directions", () => {
    for (const dir of ["asc", "desc"] as const) {
      expect(compareValues(null, "a", dir)).toBeGreaterThan(0);
      expect(compareValues("", 1, dir)).toBeGreaterThan(0);
      expect(compareValues(1, undefined, dir)).toBeLessThan(0);
      expect(compareValues(null, "", dir)).toBe(0);
    }
  });
});

describe("sortRows / nextSort", () => {
  const rows = [{ n: "b", v: 1 }, { n: "a", v: 1 }, { n: "c", v: 2 }];
  it("breaks ties A→Z whatever the direction", () => {
    const out = sortRows(rows, { key: "v", dir: "desc" }, (r, k) => r[k as "v"], r => r.n);
    expect(out.map(r => r.n)).toEqual(["c", "a", "b"]);
  });
  it("does not change the input", () => {
    sortRows(rows, { key: "n", dir: "asc" }, r => r.n);
    expect(rows.map(r => r.n)).toEqual(["b", "a", "c"]);
  });
  it("flips the same column, starts a new one in its first direction", () => {
    expect(nextSort({ key: "a", dir: "asc" }, "a")).toEqual({ key: "a", dir: "desc" });
    expect(nextSort<"a" | "b">({ key: "a", dir: "desc" }, "b", "desc")).toEqual({ key: "b", dir: "desc" });
    expect(nextSort<"a" | "b">({ key: "a", dir: "desc" }, "b")).toEqual({ key: "b", dir: "asc" });
  });
});

