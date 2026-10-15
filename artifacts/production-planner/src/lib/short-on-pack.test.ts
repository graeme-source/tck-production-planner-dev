import { describe, it, expect } from "vitest";
import type { ScheduleRecipeInput } from "@workspace/production-schedule";
import {
  shortOnPackReport, suggestProductionOrder, shortOnPackMessage, classifyRecipe, meatReadyMinutes,
  plannedPacksNetOfBags, pickNextPlan, type PackCalcRow, type NextPlanItem, type OrderInputs,
} from "./short-on-pack";

const calc = (over: Partial<PackCalcRow> & { recipeId: number }): PackCalcRow => ({
  recipeName: `R${over.recipeId}`, recipeCategory: "Calzones", isCoreMenu: true, packsPerBatch: 5, packSize: 2,
  fridgeStock: 0, predictedFridgeStock: 0, shopifyStock: null, remainingWrappingPacksToday: 0,
  dispatch2Qty: 0, ...over,
});

const item = (itemId: number, recipeId: number, over: Partial<NextPlanItem> = {}): NextPlanItem => ({
  itemId, recipeId, recipeName: `R${recipeId}`, recipeCategory: "Calzones", batchesTarget: 4, eightPackBagCount: 0, ...over,
});

describe("pickNextPlan", () => {
  it("prefers the real plan over a draft on the same date, newest first", () => {
    expect(pickNextPlan([{ id: 198, status: "draft" }, { id: 199, status: "active" }])?.id).toBe(199);
    expect(pickNextPlan([{ id: 201, status: "draft" }, { id: 199, status: "active" }])?.id).toBe(199);
    expect(pickNextPlan([{ id: 3, status: "active" }, { id: 4, status: "prep" }])?.id).toBe(4);
  });
  it("falls back to a draft when that's all there is, and to null when there's nothing", () => {
    expect(pickNextPlan([{ id: 5, status: "draft" }])?.id).toBe(5);
    expect(pickNextPlan([])).toBeNull();
  });
});

describe("plannedPacksNetOfBags", () => {
  it("is batches × packs per batch less 8-pack bags (4 two-packs a bag)", () => {
    expect(plannedPacksNetOfBags(6, 5, 2, 0)).toBe(30);
    expect(plannedPacksNetOfBags(6, 5, 2, 2)).toBe(22);
    expect(plannedPacksNetOfBags(1, 5, 2, 5)).toBe(0);
  });
});

describe("shortOnPackReport", () => {
  it("compares end-of-today stock with what's left to dispatch, most short first", () => {
    const rows = [
      calc({ recipeId: 1, predictedFridgeStock: 20, dispatch2Qty: 32 }),
      calc({ recipeId: 2, predictedFridgeStock: 10, dispatch2Qty: 50, dispatch2RemainingQty: 13 }),
      calc({ recipeId: 3, predictedFridgeStock: 40, dispatch2Qty: 40 }),
    ];
    const r = shortOnPackReport(rows, [item(11, 1, { batchesTarget: 2 })]);
    expect(r.lines.map(l => [l.recipeId, l.shortBy, l.batchesShort])).toEqual([[1, 12, 3], [2, 3, 1]]);
    expect(r.lines[0]).toMatchObject({ haveEndOfToday: 20, ordered: 32, plannedPacks: 10, shortAfterMake: 2 });
    expect(r.lines[1].plannedPacks).toBeNull();
    expect(r.totalShortPacks).toBe(15);
  });

  it("leaves out fried chicken and non-core recipes that aren't on the plan", () => {
    const rows = [
      calc({ recipeId: 1, recipeCategory: "Fried Chicken", dispatch2Qty: 30 }),
      calc({ recipeId: 2, isCoreMenu: false, dispatch2Qty: 30 }),
      calc({ recipeId: 3, isCoreMenu: false, dispatch2Qty: 30 }),
    ];
    expect(shortOnPackReport(rows, [item(13, 3)]).lines.map(l => l.recipeId)).toEqual([3]);
  });

  it("counts mac cheese in packs, not batches", () => {
    const rows = [calc({ recipeId: 5, recipeCategory: "Macaroni Cheese", packsPerBatch: 1, packSize: 1, dispatch2Qty: 9, predictedFridgeStock: 3 })];
    const [l] = shortOnPackReport(rows, [item(15, 5, { recipeCategory: "Macaroni Cheese", batchesTarget: 4 })]).lines;
    expect(l).toMatchObject({ line: "mac", shortBy: 6, batchesShort: null, plannedPacks: 4, shortAfterMake: 2 });
  });
});

describe("classifyRecipe", () => {
  const slow = new Set([22]);
  it("reads slow meat, meat and veg from data", () => {
    expect(classifyRecipe("meat", [22, 5], slow).kind).toBe("slow_meat");
    expect(classifyRecipe(null, [5], slow).kind).toBe("meat");
    expect(classifyRecipe("vegetarian", [], slow).kind).toBe("veg");
    expect(classifyRecipe("meat", [], slow)).toEqual({ kind: "meat", unmarked: false });
  });
  it("keeps an unmarked recipe with no raw meat among the meats", () => {
    expect(classifyRecipe(null, [], slow)).toEqual({ kind: "meat", unmarked: true });
  });
});

describe("meatReadyMinutes", () => {
  it("is the earliest-in time plus the slowest slow meat's lead; fast meats don't count", () => {
    const r = { meats: [
      { rawMeatIngredientId: 22, rawMeatName: "a", processMinutes: 240 },
      { rawMeatIngredientId: 9, rawMeatName: "b", processMinutes: 400 },
    ] };
    expect(meatReadyMinutes(r, new Set([22]))).toBe(10 * 60);
    expect(meatReadyMinutes(r, new Set())).toBeNull();
    expect(meatReadyMinutes(r, new Set([22]), 5 * 60)).toBe(9 * 60);
  });
});

// The building line: 2 builders, 4 min a batch each → 2 min a batch; 4
// batches = 8 min; no changeover or breaks so the clock is easy to follow.
const engine = (planItemId: number, recipeId: number, meats: ScheduleRecipeInput["meats"] = [], batches = 4): ScheduleRecipeInput => ({
  planItemId, recipeId, name: `R${recipeId}`, batches, minutesPerBatch: 4, meats,
});
const base = (over: Partial<OrderInputs>): OrderInputs => ({
  items: [], timeline: [],
  options: { startMinutes: 7 * 60 + 30, buildersCount: 2, changeoverSeconds: 0 },
  breaks: [],
  dietaryByRecipe: new Map(), slowMeatIds: new Set([99]), shortByRecipe: new Map(),
  ...over,
});
const slowMeat = (lead: number) => [{ rawMeatIngredientId: 99, rawMeatName: "slow", processMinutes: lead }];
const fastMeat = [{ rawMeatIngredientId: 7, rawMeatName: "fast", processMinutes: 40 }];

describe("suggestProductionOrder", () => {
  it("puts veg before meat, most short first within each", () => {
    const items = [item(1, 1), item(2, 2), item(3, 3), item(4, 4)];
    const s = suggestProductionOrder(base({
      items,
      timeline: [engine(1, 1, fastMeat), engine(2, 2), engine(3, 3, fastMeat), engine(4, 4)],
      dietaryByRecipe: new Map([[2, "vegetarian"], [4, "vegetarian"], [1, "meat"], [3, "meat"]]),
      shortByRecipe: new Map([[3, 12], [4, 2]]),
    }));
    expect(s.suggested.rows.map(r => r.recipeId)).toEqual([4, 2, 3, 1]);
    expect(s.suggested.rows[0].reason).toBe("Veg · short by 2 packs — veg goes first");
    expect(s.suggested.rows[2].reason).toBe("Meat · short by 12 packs — as early as the rules allow");
    expect(s.changed).toBe(true);
    expect(s.order).toEqual([{ itemId: 4, orderPosition: 1 }, { itemId: 2, orderPosition: 2 }, { itemId: 3, orderPosition: 3 }, { itemId: 1, orderPosition: 4 }]);
  });

  it("never starts slow meat before it's ready — other meats fill the gap", () => {
    // Slow meat in at 06:00 + 4h lead → ready 10:00; building starts 07:30.
    const items = [item(1, 1), item(2, 2)];
    const s = suggestProductionOrder(base({
      items,
      timeline: [engine(1, 1, slowMeat(240)), engine(2, 2, fastMeat)],
      dietaryByRecipe: new Map([[1, "meat"], [2, "meat"]]),
      shortByRecipe: new Map([[1, 30]]),
    }));
    expect(s.suggested.rows.map(r => r.recipeId)).toEqual([2, 1]);
    expect(s.suggested.rows[0].reason).toBe("Meat — goes while the slow meat cooks");
    expect(s.suggested.rows[1]).toMatchObject({ meatReady: "10:00", start: "10:00", waitMinutes: 142 });
    expect(s.suggested.rows[1].reason).toBe("Slow meat ready ~10:00 · short by 30 packs · line waits 142 min");
    // Today's order would have built it at 07:30 — the current plan shows the wait it really implies.
    expect(s.current.rows[0]).toMatchObject({ recipeId: 1, start: "10:00", waitMinutes: 150 });
  });

  it("runs a short slow meat as soon as it's ready, ahead of non-short meats", () => {
    // Lots of veg (8 × 40 min) take the clock past 10:00.
    const veg = [5, 6, 7, 8].map(n => engine(n, n, [], 20));
    const items = [item(1, 1), item(2, 2), ...[5, 6, 7, 8].map(n => item(n, n))];
    const s = suggestProductionOrder(base({
      items,
      timeline: [engine(1, 1, fastMeat), engine(2, 2, slowMeat(240)), ...veg],
      dietaryByRecipe: new Map([[5, "vegetarian"], [6, "vegetarian"], [7, "vegetarian"], [8, "vegetarian"]]),
      shortByRecipe: new Map([[2, 4]]),
    }));
    expect(s.suggested.rows.map(r => r.recipeId)).toEqual([5, 6, 7, 8, 2, 1]);
    expect(s.suggested.totalWaitMinutes).toBe(0);
  });

  it("keeps mac lines in their slots (most short first) and leaves other lines alone", () => {
    const items = [
      item(1, 1, { recipeCategory: "Macaroni Cheese" }),
      item(2, 2, { recipeCategory: "Macaroni Cheese" }),
      item(3, 3, { recipeCategory: "Fried Chicken" }),
      item(4, 4), item(5, 5),
    ];
    const s = suggestProductionOrder(base({
      items,
      timeline: [engine(4, 4, fastMeat), engine(5, 5)],
      dietaryByRecipe: new Map([[5, "vegetarian"]]),
      shortByRecipe: new Map([[2, 6]]),
    }));
    expect(s.suggested.rows.map(r => r.itemId)).toEqual([2, 1, 3, 5, 4]);
    expect(s.suggested.rows[0].reason).toBe("Mac & Cheese station · short by 6 packs");
    expect(s.suggested.rows[2].station).toBe("other");
  });

  it("reports no change when the plan already follows the rules", () => {
    const items = [item(1, 1), item(2, 2)];
    const s = suggestProductionOrder(base({
      items,
      timeline: [engine(1, 1), engine(2, 2, fastMeat)],
      dietaryByRecipe: new Map([[1, "vegetarian"]]),
    }));
    expect(s.changed).toBe(false);
  });

  it("drops breaks in by anchor time, as the day schedule does", () => {
    const items = [item(1, 1), item(2, 2)];
    const s = suggestProductionOrder(base({
      items,
      timeline: [engine(1, 1, [], 30), engine(2, 2, [], 30)],
      dietaryByRecipe: new Map([[1, "vegetarian"], [2, "vegetarian"]]),
      breaks: [{ id: "morning", label: "Morning break", minutes: 15, anchorMinutes: 8 * 60 }],
    }));
    // 07:30–08:30, break 08:30–08:45, then 08:45.
    expect(s.suggested.rows.map(r => r.start)).toEqual(["07:30", "08:45"]);
  });
});

describe("shortOnPackMessage", () => {
  const lines = shortOnPackReport([
    calc({ recipeId: 1, recipeName: "Alpha", predictedFridgeStock: 0, dispatch2Qty: 12 }),
    calc({ recipeId: 2, recipeName: "Beta", predictedFridgeStock: 0, dispatch2Qty: 1 }),
  ], [item(11, 1)]).lines;

  it("lists what's short, without claiming a reorder that hasn't happened", () => {
    expect(shortOnPackMessage({ dayName: "tomorrow", lines })).toBe(
      "Tomorrow we're short on the pack:\n• Alpha — short 12 packs (3 batches)\n• Beta — short 1 pack (1 batch) — not on the plan",
    );
  });

  it("names the day on a Friday and adds the new order once it's saved", () => {
    const msg = shortOnPackMessage({ dayName: "Monday", lines: lines.slice(0, 1), reorderedTo: ["Alpha", "Gamma"] });
    expect(msg).toBe(
      "On Monday we're short on the pack:\n• Alpha — short 12 packs (3 batches)\n\nI've reordered the production plan based on this:\n1. Alpha\n2. Gamma",
    );
  });
});
