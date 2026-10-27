import { describe, it, expect } from "vitest";
import { nextAction, countdownText } from "./next-action";
import { replanLive, meatKey } from "./live-replan";
import type { ScheduleRecipeInput, ScheduleOptions } from "./index";

const recipes: ScheduleRecipeInput[] = [
  { planItemId: 1, recipeId: 101, name: "Margherita", batches: 8, minutesPerBatch: 5, meats: [] },
  { planItemId: 2, recipeId: 102, name: "Godfather", batches: 8, minutesPerBatch: 5,
    meats: [{ rawMeatIngredientId: 306, rawMeatName: "Beef Mince", processMinutes: 45, cookMinutes: 30, bufferMinutes: 5 }] },
  { planItemId: 3, recipeId: 103, name: "Carnizone", batches: 8, minutesPerBatch: 5,
    meats: [{ rawMeatIngredientId: 191, rawMeatName: "Chicken", processMinutes: 40, cookMinutes: 24, bufferMinutes: 10 }] },
];
const options: ScheduleOptions = { startMinutes: 420, buildersCount: 2, changeoverSeconds: 0, breaks: [] };
// Godfather needed 07:20 → beef in 06:35; Carnizone 07:40 → chicken in 07:00.
const live = (meatsStarted = new Set<string>()) =>
  replanLive({ recipes, options, progress: [], ticks: [], nowMinutes: 380, pace: null, meatsStarted });

describe("nextAction — the one big thing to do next", () => {
  it("the earliest meat not yet in, with a countdown", () => {
    const a = nextAction(live(), 383)!;
    expect(a).toMatchObject({ kind: "put_in", ingredientName: "Beef Mince", recipeName: "Godfather", atMinutes: 395, outMinutes: 425, minutesUntil: 12, status: "later" });
    expect(countdownText(a.minutesUntil)).toBe("in 12 min");
  });
  it("due at the time, red once overdue", () => {
    expect(nextAction(live(), 395)!.status).toBe("due");
    expect(nextAction(live(), 400)!.status).toBe("due");
    expect(nextAction(live(), 401)!.status).toBe("overdue");
    expect(countdownText(-6)).toBe("6 min late");
  });
  it("moves on once that meat is in", () => {
    const a = nextAction(live(new Set([meatKey(102, 306)])), 383)!;
    expect(a).toMatchObject({ ingredientName: "Chicken", atMinutes: 420 });
  });
  it("all meat in → the next mix; cold mixes are 'any time before'", () => {
    const allIn = live(new Set([meatKey(102, 306), meatKey(103, 191)]));
    const a = nextAction(allIn, 383)!;
    expect(a).toMatchObject({ kind: "mix", recipeName: "Margherita", anyTimeBefore: true });
    const b = nextAction(allIn, 383, { mixedPlanItemIds: new Set([1]) })!;
    expect(b).toMatchObject({ kind: "mix", recipeName: "Godfather", atMinutes: 440, anyTimeBefore: false });
  });
  it("nothing left → null", () => {
    expect(nextAction(live(new Set([meatKey(102, 306), meatKey(103, 191)])), 383, { mixedPlanItemIds: new Set([1, 2, 3]) })).toBeNull();
  });
  it("countdown text", () => {
    expect(countdownText(0)).toBe("now");
    expect(countdownText(65)).toBe("in 1 h 5 min");
  });
});
