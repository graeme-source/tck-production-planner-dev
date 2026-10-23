import { describe, expect, it } from "vitest";
import { compactRowsKey, compactRowsOn, priorityEdgeClass, todayHeaderLine } from "./team-list-view";

// #330: a slimmer Team list header and a Compact switch, so Jane sees her
// whole day without scrolling.
describe("slim team list header", () => {
  it("reads 'Today · Thu 15 Oct · 3 of 10 done' on one line", () => {
    expect(todayHeaderLine("2026-10-15", "3 of 10 done")).toBe("Today · Thu 15 Oct · 3 of 10 done");
  });
});

describe("Compact switch", () => {
  it("is off until turned on, and remembered per person", () => {
    expect(compactRowsOn(null)).toBe(false);
    expect(compactRowsOn("0")).toBe(false);
    expect(compactRowsOn("1")).toBe(true);
    expect(compactRowsKey(7)).not.toBe(compactRowsKey(8));
  });
});

describe("priority edge", () => {
  it("colours P1-P3 and leaves P4 plain", () => {
    expect(priorityEdgeClass(1)).toBe("border-l-red-500");
    expect(priorityEdgeClass(3)).toBe("border-l-blue-500");
    expect(priorityEdgeClass(4)).toBe("");
  });
});
