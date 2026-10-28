import { describe, it, expect } from "vitest";
import {
  hasCalzoneLine, mergeBlock, pickMergeTarget, mergedStatus, mergedNotes, planMergeLayout, isRepeatMerge,
} from "./plan-merge";
import { FRIED_CHICKEN_CATEGORY, MAC_CHEESE_CATEGORY } from "./kitchen-scope";

const FC = { recipeCategory: FRIED_CHICKEN_CATEGORY };
const MAC = { recipeCategory: MAC_CHEESE_CATEGORY };
const CALZONE = { recipeCategory: "Calzone" };

describe("hasCalzoneLine", () => {
  it("is false for an item-less day, fried chicken only and mac cheese only", () => {
    expect(hasCalzoneLine([])).toBe(false);
    expect(hasCalzoneLine([FC, FC])).toBe(false);
    expect(hasCalzoneLine([MAC, FC])).toBe(false);
  });
  it("is true as soon as any calzone-line item is on the plan (including uncategorised)", () => {
    expect(hasCalzoneLine([FC, CALZONE])).toBe(true);
    expect(hasCalzoneLine([{ recipeCategory: null }])).toBe(true);
  });
});

describe("mergeBlock", () => {
  const plan = { planDate: "2026-11-02", status: "active" };
  it("allows a fried-chicken-only plan on the same day", () => {
    expect(mergeBlock(plan, [FC], "2026-11-02")).toBeNull();
  });
  it("refuses another day, a finished day, or a plan that already has calzones", () => {
    expect(mergeBlock(plan, [FC], "2026-11-03")).toBe("wrong-date");
    expect(mergeBlock({ ...plan, status: "complete" }, [FC], "2026-11-02")).toBe("complete");
    expect(mergeBlock(plan, [FC, CALZONE], "2026-11-02")).toBe("has-calzones");
  });
});

describe("pickMergeTarget", () => {
  const day = "2026-11-02";
  it("is null when the day has no plan — a plain create", () => {
    expect(pickMergeTarget([{ id: 1, planDate: "2026-11-03", status: "active", items: [FC] }], day)).toBeNull();
  });
  it("picks the fried chicken plan made on an empty day", () => {
    const t = pickMergeTarget([{ id: 7, planDate: day, status: "active", items: [FC, FC] }], day);
    expect(t?.id).toBe(7);
  });
  it("picks an item-less day plan (the empty-day button before chicken is saved)", () => {
    expect(pickMergeTarget([{ id: 8, planDate: day, status: "active", items: [] }], day)?.id).toBe(8);
    expect(pickMergeTarget([{ id: 9, planDate: day, status: "active" }], day)?.id).toBe(9);
  });
  it("never merges when the day already has calzones — that is a real clash", () => {
    const plans = [
      { id: 1, planDate: day, status: "active", items: [FC] },
      { id: 2, planDate: day, status: "active", items: [CALZONE] },
    ];
    expect(pickMergeTarget(plans, day)).toBeNull();
  });
  it("prefers the oldest mergeable plan and skips finished ones and the dialog's own draft", () => {
    const plans = [
      { id: 5, planDate: day, status: "complete", items: [FC] },
      { id: 12, planDate: day, status: "active", items: [MAC] },
      { id: 10, planDate: day, status: "active", items: [FC] },
      { id: 3, planDate: day, status: "draft", items: [] },
    ];
    expect(pickMergeTarget(plans, day)?.id).toBe(3);
    expect(pickMergeTarget(plans, day, 3)?.id).toBe(10);
  });
});

describe("mergedStatus", () => {
  it("never steps a plan backwards", () => {
    expect(mergedStatus("active", "draft")).toBe("active");
    expect(mergedStatus("building", "active")).toBe("building");
  });
  it("lifts a draft day when the calzone plan is activated", () => {
    expect(mergedStatus("draft", "active")).toBe("active");
    expect(mergedStatus("draft", undefined)).toBe("draft");
  });
});

describe("mergedNotes", () => {
  it("keeps both, without repeating identical notes", () => {
    expect(mergedNotes(null, "Big Friday")).toBe("Big Friday");
    expect(mergedNotes("Chicken 75 kg", null)).toBe("Chicken 75 kg");
    expect(mergedNotes("Chicken 75 kg", "Big Friday")).toBe("Chicken 75 kg\nBig Friday");
    expect(mergedNotes("Same", " Same ")).toBe("Same");
    expect(mergedNotes("", "  ")).toBeNull();
  });
});

describe("planMergeLayout", () => {
  it("adds calzones before the fried chicken already on the plan, as if made together", () => {
    const existing = [
      { id: 101, recipeId: 50, ...FC, orderPosition: 1 },
      { id: 102, recipeId: 51, ...FC, orderPosition: 2 },
    ];
    const incoming = [{ recipeId: 1 }, { recipeId: 2 }, { recipeId: 3 }];
    const layout = planMergeLayout(existing, incoming);
    expect(layout.inserts).toEqual([
      { incomingIndex: 0, orderPosition: 1 },
      { incomingIndex: 1, orderPosition: 2 },
      { incomingIndex: 2, orderPosition: 3 },
    ]);
    expect(layout.moves).toEqual([
      { id: 101, orderPosition: 4 },
      { id: 102, orderPosition: 5 },
    ]);
    expect(layout.skippedRecipeIds).toEqual([]);
  });

  it("keeps mac cheese at the top, then calzones, then fried chicken", () => {
    const existing = [
      { id: 201, recipeId: 60, ...FC, orderPosition: 2 },
      { id: 200, recipeId: 70, ...MAC, orderPosition: 1 },
    ];
    const layout = planMergeLayout(existing, [{ recipeId: 1 }]);
    expect(layout.inserts).toEqual([{ incomingIndex: 0, orderPosition: 2 }]);
    expect(layout.moves).toEqual([{ id: 201, orderPosition: 3 }]);
  });

  it("never duplicates a recipe already on the plan — the existing line (and its counts) wins", () => {
    const existing = [{ id: 301, recipeId: 60, ...FC, orderPosition: 1 }];
    const layout = planMergeLayout(existing, [{ recipeId: 1 }, { recipeId: 60 }, { recipeId: 1 }]);
    expect(layout.inserts).toEqual([{ incomingIndex: 0, orderPosition: 1 }]);
    expect(layout.skippedRecipeIds).toEqual([60]);
    expect(layout.moves).toEqual([{ id: 301, orderPosition: 2 }]);
  });

  it("on an item-less day plan is a plain create", () => {
    const layout = planMergeLayout([], [{ recipeId: 1 }, { recipeId: 2 }]);
    expect(layout.inserts.map(i => i.orderPosition)).toEqual([1, 2]);
    expect(layout.moves).toEqual([]);
  });
});

describe("isRepeatMerge", () => {
  const existing = [{ recipeId: 1, batchesTarget: 6 }, { recipeId: 2, batchesTarget: 4 }, { recipeId: 60, batchesTarget: 30 }];
  it("recognises the same create arriving twice", () => {
    expect(isRepeatMerge(existing, [{ recipeId: 1, batchesTarget: 6 }, { recipeId: 2, batchesTarget: 4 }])).toBe(true);
  });
  it("is false for a different plan or an empty one", () => {
    expect(isRepeatMerge(existing, [{ recipeId: 1, batchesTarget: 7 }])).toBe(false);
    expect(isRepeatMerge(existing, [{ recipeId: 3, batchesTarget: 6 }])).toBe(false);
    expect(isRepeatMerge(existing, [])).toBe(false);
  });
});
