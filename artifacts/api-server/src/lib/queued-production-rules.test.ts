import { describe, expect, it } from "vitest";
import { classifyIngredientNeed, outstanding, packsPerBatch, suggestQueueBatches } from "./queued-production-rules";

describe("suggested batches from sales (sold + 5, whole batches)", () => {
  it("Graeme's example: 91 sold at 10 packs a batch → 96 → 10 batches = 100 packs", () => {
    expect(suggestQueueBatches({ packsSold: 91, packSize: 2, portionsPerBatch: 20 })).toEqual({
      packsSold: 91, requiredPacks: 96, batches: 10, packsMade: 100, unitsMade: 200,
    });
  });
  it("a calzone batch is 5 two-packs: 90 sold → 95 → 19 batches", () => {
    expect(suggestQueueBatches({ packsSold: 90, packSize: 2, portionsPerBatch: 10 })).toMatchObject({ batches: 19, packsMade: 95, unitsMade: 190 });
  });
  it("always at least 5 extra: 95 sold → 100 → 20 batches (not 19)", () => {
    expect(suggestQueueBatches({ packsSold: 95, packSize: 2, portionsPerBatch: 10 }).batches).toBe(20);
  });
  it("single pots: 40 sold, 4 a batch → 45 → 12 batches = 48 pots", () => {
    expect(suggestQueueBatches({ packsSold: 40, packSize: 1, portionsPerBatch: 4 })).toMatchObject({ batches: 12, packsMade: 48 });
  });
  it("nothing sold → nothing suggested", () => {
    expect(suggestQueueBatches({ packsSold: 0, packSize: 2, portionsPerBatch: 10 }).batches).toBe(0);
  });
  it("float pack sizes don't add a batch (2.0000)", () => {
    expect(packsPerBatch(10, 2.0000000001)).toBe(5);
    expect(suggestQueueBatches({ packsSold: 20, packSize: 2.0000000001, portionsPerBatch: 10 }).batches).toBe(5);
  });
});

describe("which ingredients the queue lists to order", () => {
  const base = { required: 3.54, inbound: 0, isRoutine: true, recentlyOrdered: true, recentlyUsed: true, stockNow: null as number | null, weeklyUse: 0 as number | null };

  it("not routinely stocked → special, order all of it (open orders are for normal production)", () => {
    expect(classifyIngredientNeed({ ...base, isRoutine: false, inbound: 1 })).toMatchObject({ status: "special", reason: "not-stocked", toOrder: 3.54 });
  });
  it("kanban but not ordered in the last month (fresh thyme) → special", () => {
    expect(classifyIngredientNeed({ ...base, recentlyOrdered: false, stockNow: 100, weeklyUse: 50 })).toMatchObject({ status: "special", reason: "not-ordered" });
  });
  it("ordered but not used by normal production in the last month → special", () => {
    expect(classifyIngredientNeed({ ...base, recentlyUsed: false, stockNow: 100, weeklyUse: 50 })).toMatchObject({ status: "special", reason: "not-used" });
  });
  it("flour — stocked, ordered and used every week — is never special", () => {
    expect(classifyIngredientNeed({ ...base, required: 37.91, stockNow: 269.37, weeklyUse: 231.63 }).status).toBe("covered");
  });
  it("kanban, never counted, barely used (the Malbec) → check", () => {
    expect(classifyIngredientNeed(base)).toMatchObject({ status: "check", toOrder: 3.54 });
  });
  it("kanban, never counted, test needs more than half a normal week → check", () => {
    expect(classifyIngredientNeed({ ...base, required: 11.3, weeklyUse: 20 }).status).toBe("check");
  });
  it("kanban, never counted, a staple the test barely dents → covered", () => {
    expect(classifyIngredientNeed({ ...base, required: 1.04, weeklyUse: 30 }).status).toBe("covered");
  });
  it("counted stock plus inbound short of the test → short, order the gap (the crispy bacon at 0)", () => {
    expect(classifyIngredientNeed({ ...base, required: 16.03, stockNow: 12.5, weeklyUse: 48.76, inbound: 1 })).toMatchObject({ status: "short", toOrder: 2.53 });
    expect(classifyIngredientNeed({ ...base, required: 1.88, stockNow: 0, weeklyUse: 0 })).toMatchObject({ status: "short", toOrder: 1.88 });
  });
  it("normal use before the day is not taken off (a December test must not order 582 kg of flour)", () => {
    expect(classifyIngredientNeed({ ...base, required: 37.91, stockNow: 269.37, weeklyUse: 231.63 }).status).toBe("covered");
  });
  it("stock covers the test but not a normal week on top, and the test is big → check", () => {
    // 20 needed, 25 in stock, 28 a week: covered today, gone once normal production starts.
    expect(classifyIngredientNeed({ ...base, required: 20, stockNow: 25, weeklyUse: 28 })).toMatchObject({ status: "check", toOrder: 20 });
    // Milk: 10.6 of a 28.4 a week is under half — normal ordering absorbs it.
    expect(classifyIngredientNeed({ ...base, required: 10.58, stockNow: 15.89, weeklyUse: 28.43 }).status).toBe("covered");
  });
  it("stock with a normal week to spare → covered, however big the test", () => {
    expect(classifyIngredientNeed({ ...base, required: 34.05, stockNow: 312.97, weeklyUse: 136.92 }).status).toBe("covered");
  });
  it("still to order = listed, something to order, not ticked ordered or not needed", () => {
    expect(outstanding("check", 3.54, null)).toBe(true);
    expect(outstanding("short", 1, null)).toBe(true);
    expect(outstanding("special", 2, "ordered")).toBe(false);
    expect(outstanding("special", 2, "not_needed")).toBe(false);
    expect(outstanding("special", 0, null)).toBe(false);
    expect(outstanding("covered", 5, null)).toBe(false);
  });
});
