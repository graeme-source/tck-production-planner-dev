import { describe, it, expect } from "vitest";
import {
  batchesFor, packsSoldByRecipe, planQueueDiff, planUnqueue, titleWords,
  type BoxRecipeLinks, type QueueRow, type SalesLine, type SalesOrder,
} from "./test-box-production";

const recipes: BoxRecipeLinks[] = [
  { recipeId: 33, name: "Properoni Chicken & Chorizo", variantIds: ["111"], productIds: [] },
  { recipeId: 34, name: "Properoni Carnizone", variantIds: [], productIds: [] },
  { recipeId: 35, name: "Properoni Chilli Chorizo & Fior Di Latte", variantIds: [], productIds: ["P35"] },
];
let lineId = 0;
const line = (over: Partial<SalesLine>): SalesLine => ({ id: String(++lineId), variantId: null, productId: null, title: null, variantTitle: null, quantity: 1, ...over });
const order = (over: Partial<SalesOrder>): SalesOrder => ({ id: "o", name: "#1", tags: "2026-10-16, Friday, Small Box", cancelledAt: null, lineItems: [], refunds: [], ...over });

describe("packs sold for one delivery date", () => {
  it("counts mapped variants, box-created products and (unmapped only) product titles", () => {
    const r = packsSoldByRecipe([
      order({ lineItems: [
        line({ variantId: "111", quantity: 2, title: "Properoni Chicken & Chorizo" }),
        line({ variantId: "222", title: "Properoni - CarniZone 🍗 🍖🥩", quantity: 3 }),
        line({ variantId: "333", productId: "P35", title: "Properoni Chorizo Chilli & Fior Di Latte" }),
      ] }),
    ], "2026-10-16", recipes);
    expect(Object.fromEntries(r.packs)).toEqual({ 33: 2, 34: 3, 35: 1 });
    expect(Object.fromEntries(r.matchedBy)).toEqual({ 33: "mapped", 34: "title", 35: "mapped" });
    expect(r.orders).toBe(1);
  });

  it("ignores cancelled orders, other delivery dates, orders with no date, and other products", () => {
    const r = packsSoldByRecipe([
      order({ cancelledAt: "2026-10-05T10:00:00Z", lineItems: [line({ variantId: "111", quantity: 5 })] }),
      order({ tags: "2026-10-13, Tuesday", lineItems: [line({ variantId: "111", quantity: 7 })] }),
      order({ tags: "Small Box", lineItems: [line({ variantId: "111", quantity: 9 })] }),
      order({ lineItems: [line({ variantId: "999", title: "Classic Pepperoni", quantity: 4 })] }),
    ], "2026-10-16", recipes);
    expect(Object.fromEntries(r.packs)).toEqual({ 33: 0, 34: 0, 35: 0 });
    expect(r.orders).toBe(0);
  });

  it("nets off refunded quantities per line, never below zero", () => {
    const a = line({ variantId: "111", quantity: 3 });
    const b = line({ variantId: "111", quantity: 1 });
    const r = packsSoldByRecipe([order({ lineItems: [a, b], refunds: [{ lineItemId: a.id, quantity: 1 }, { lineItemId: b.id, quantity: 4 }] })], "2026-10-16", recipes);
    expect(r.packs.get(33)).toBe(2);
  });

  it("a mapped recipe is never matched by title (a renamed product can't double count)", () => {
    const r = packsSoldByRecipe([order({ lineItems: [line({ variantId: "555", title: "Properoni Chicken & Chorizo", quantity: 4 })] })], "2026-10-16", recipes);
    expect(r.packs.get(33)).toBe(0);
  });

  it("8-pack bags are never counted by title", () => {
    const r = packsSoldByRecipe([order({ lineItems: [line({ title: "Properoni Carnizone", variantTitle: "8 Pack Bag", quantity: 1 })] })], "2026-10-16", recipes);
    expect(r.packs.get(34)).toBe(0);
  });

  it("titles match on the same words in any order", () => {
    expect(titleWords("Properoni - CarniZone 🍗 🍖🥩")).toBe(titleWords("Properoni Carnizone"));
    expect(titleWords("Properoni Chorizo Chilli & Fior Di Latte")).toBe(titleWords("Properoni Chilli Chorizo and Fior Di Latte"));
    expect(titleWords("Properoni Chorizo")).not.toBe(titleWords("Properoni Chorizo Chilli"));
  });
});

describe("batches from packs", () => {
  it("rounds up to whole batches (the Properoni numbers)", () => {
    expect(batchesFor({ packs: 50, packSize: 2, portionsPerBatch: 10, safetyBatch: false })).toEqual({ calzones: 100, batches: 10 });
    expect(batchesFor({ packs: 32, packSize: 2, portionsPerBatch: 10, safetyBatch: false })).toEqual({ calzones: 64, batches: 7 });
    expect(batchesFor({ packs: 25, packSize: 2, portionsPerBatch: 10, safetyBatch: false })).toEqual({ calzones: 50, batches: 5 });
  });
  it("adds one safety batch per recipe when asked — but not for a recipe that didn't sell", () => {
    expect(batchesFor({ packs: 25, packSize: 2, portionsPerBatch: 10, safetyBatch: true }).batches).toBe(6);
    expect(batchesFor({ packs: 0, packSize: 2, portionsPerBatch: 10, safetyBatch: true })).toEqual({ calzones: 0, batches: 0 });
  });
  it("odd numbers and bad settings", () => {
    expect(batchesFor({ packs: 1, packSize: 2, portionsPerBatch: 10, safetyBatch: false }).batches).toBe(1);
    expect(batchesFor({ packs: 5, packSize: 0, portionsPerBatch: 0, safetyBatch: false })).toEqual({ calzones: 5, batches: 1 });
  });
});

describe("queue diff — idempotent", () => {
  const row = (id: number, recipeId: number, batches: number, over: Partial<QueueRow> = {}): QueueRow => ({ id, recipeId, batches, status: "queued", testBoxDeliveryId: 1, ...over });

  it("first run inserts one row per recipe that sold", () => {
    expect(planQueueDiff([{ recipeId: 33, batches: 7 }, { recipeId: 34, batches: 10 }, { recipeId: 35, batches: 0 }], [], 1)).toEqual({
      actions: [{ kind: "insert", recipeId: 33, batches: 7 }, { kind: "insert", recipeId: 34, batches: 10 }],
      warnings: [],
    });
  });

  it("re-running with the same numbers does nothing; changed numbers update in place", () => {
    const rows = [row(1, 33, 7), row(2, 34, 10)];
    expect(planQueueDiff([{ recipeId: 33, batches: 7 }, { recipeId: 34, batches: 10 }], rows, 1).actions).toEqual([]);
    expect(planQueueDiff([{ recipeId: 33, batches: 8 }, { recipeId: 34, batches: 10 }], rows, 1).actions)
      .toEqual([{ kind: "update", id: 1, recipeId: 33, batches: 8, adopt: false }]);
  });

  it("a recipe no longer wanted is taken off; duplicates of the box's own rows are tidied", () => {
    const rows = [row(1, 33, 7), row(2, 34, 10), row(3, 34, 10)];
    expect(planQueueDiff([{ recipeId: 34, batches: 10 }], rows, 1).actions).toEqual([
      { kind: "cancel", id: 3, recipeId: 34 },
      { kind: "cancel", id: 1, recipeId: 33 },
    ]);
  });

  it("other deliveries' rows and cancelled rows are left alone", () => {
    const rows = [row(1, 33, 4, { testBoxDeliveryId: 2 }), row(2, 33, 9, { status: "cancelled" })];
    expect(planQueueDiff([{ recipeId: 33, batches: 7 }], rows, 1).actions).toEqual([{ kind: "insert", recipeId: 33, batches: 7 }]);
  });

  it("a row queued by hand for the same recipe and day is taken over, not duplicated", () => {
    const r = planQueueDiff([{ recipeId: 33, batches: 7 }], [row(5, 33, 6, { testBoxDeliveryId: null })], 1);
    expect(r.actions).toEqual([{ kind: "update", id: 5, recipeId: 33, batches: 7, adopt: true }]);
    expect(r.warnings).toEqual([{ recipeId: 33, kind: "adopted", was: 6, want: 7 }]);
  });

  it("rows a plan has already taken are never changed — a warning instead", () => {
    const r = planQueueDiff([{ recipeId: 33, batches: 9 }], [row(1, 33, 7, { status: "planned" }), row(2, 34, 5, { status: "planned" })], 1);
    expect(r.actions).toEqual([]);
    expect(r.warnings).toEqual([
      { recipeId: 33, kind: "on-plan", was: 7, want: 9 },
      { recipeId: 34, kind: "on-plan", was: 5, want: 0 },
    ]);
  });
});

describe("unqueue on reopen", () => {
  it("cancels the delivery's queued rows and reports the ones already on a plan", () => {
    const rows: QueueRow[] = [
      { id: 1, recipeId: 33, batches: 7, status: "queued", testBoxDeliveryId: 1 },
      { id: 2, recipeId: 34, batches: 10, status: "planned", testBoxDeliveryId: 1 },
      { id: 3, recipeId: 35, batches: 5, status: "queued", testBoxDeliveryId: null },
    ];
    const r = planUnqueue(rows, 1);
    expect(r.cancel).toEqual([1]);
    expect(r.onPlan.map(x => x.id)).toEqual([2]);
  });
});
