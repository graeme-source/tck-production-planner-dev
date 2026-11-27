import { describe, it, expect } from "vitest";
import { bagsToAdd, isOverdue, waitingBagsByRecipe } from "./queued-bags-rules";

const carnizone = { recipeId: 5, recipeName: "Carnizone", bags: 1 };

describe("bagsToAdd (Graeme, 22 Nov 2026: queued 8-pack orders)", () => {
  it("adds every recipe's bags when the plan has them all, duplicate lines summed", () => {
    expect(bagsToAdd([carnizone, { ...carnizone, bags: 2 }, { recipeId: 1, recipeName: "Margherita", bags: 1 }], new Set([1, 5]), "Tue 1 Dec"))
      .toEqual({ ok: true, adds: [{ recipeId: 5, recipeName: "Carnizone", bags: 3 }, { recipeId: 1, recipeName: "Margherita", bags: 1 }] });
  });
  it("waits while there's no plan", () => {
    expect(bagsToAdd([carnizone], null, "Tue 1 Dec")).toEqual({ ok: false, problem: "No production plan for Tue 1 Dec yet" });
  });
  it("adds nothing at all if any recipe isn't on the plan — never half an order", () => {
    const r = bagsToAdd([carnizone, { recipeId: 1, recipeName: "Margherita", bags: 1 }], new Set([1]), "Tue 1 Dec");
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.problem).toContain("Carnizone");
  });
});

describe("isOverdue / waitingBagsByRecipe", () => {
  it("flags a queued order on or after its make-day, and an applied one whose plan was deleted", () => {
    expect(isOverdue({ status: "queued", productionDate: "2026-12-01", planId: null }, "2026-11-30")).toBe(false);
    expect(isOverdue({ status: "queued", productionDate: "2026-12-01", planId: null }, "2026-12-01")).toBe(true);
    expect(isOverdue({ status: "applied", productionDate: "2026-12-01", planId: null }, "2026-12-02")).toBe(true);
    expect(isOverdue({ status: "applied", productionDate: "2026-12-01", planId: 240 }, "2026-12-02")).toBe(false);
  });
  it("counts only bags that aren't on a plan yet", () => {
    const m = waitingBagsByRecipe([
      { status: "queued", planId: null, lines: [carnizone] },
      { status: "applied", planId: 240, lines: [carnizone] },
      { status: "applied", planId: null, lines: [{ ...carnizone, bags: 2 }] },
      { status: "cancelled", planId: null, lines: [carnizone] },
    ]);
    expect([...m]).toEqual([[5, 3]]);
  });
});

import { planReadyForQueuedBags } from "./queued-bags-rules";

describe("planReadyForQueuedBags (27 Nov 2026: wait an hour after the plan is made)", () => {
  it("waits 60 minutes from when the plan was made", () => {
    const made = "2026-11-27T14:56:47Z";
    expect(planReadyForQueuedBags(made, new Date("2026-11-27T15:30:00Z")).ready).toBe(false);
    expect(planReadyForQueuedBags(made, new Date("2026-11-27T15:56:47Z")).ready).toBe(true);
    expect(planReadyForQueuedBags(made, new Date("2026-11-27T15:30:00Z")).readyAt.toISOString()).toBe("2026-11-27T15:56:47.000Z");
  });
});
