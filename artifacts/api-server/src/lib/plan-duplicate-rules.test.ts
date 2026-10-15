import { describe, it, expect } from "vitest";
import { isDuplicateCreate } from "./plan-duplicate-rules";

describe("plan double-submit guard (Graeme, 2026-10-15)", () => {
  const items = [{ recipeId: 1, batchesTarget: 12 }, { recipeId: 2, batchesTarget: 9 }];
  const now = new Date("2026-10-14T13:30:54.247Z");
  it("the same plan 0.7 s later is the same request", () => {
    expect(isDuplicateCreate({ createdAt: new Date("2026-10-14T13:30:53.539Z"), items }, [...items].reverse(), now)).toBe(true);
  });
  it("different batches, or minutes later, is a real second plan", () => {
    expect(isDuplicateCreate({ createdAt: new Date("2026-10-14T13:30:53.539Z"), items }, [{ recipeId: 1, batchesTarget: 12 }, { recipeId: 2, batchesTarget: 8 }], now)).toBe(false);
    expect(isDuplicateCreate({ createdAt: new Date("2026-10-14T13:20:00Z"), items }, items, now)).toBe(false);
  });
  it("an empty day plan twice in a moment is also a duplicate", () => {
    expect(isDuplicateCreate({ createdAt: new Date(now.getTime() - 500), items: [] }, [], now)).toBe(true);
  });
});
