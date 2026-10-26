import { describe, it, expect } from "vitest";
import { AREAS, areaForRotaStation, areaForSensor, mergeLayers, PLAN_H, PLAN_W, shortName } from "./floor-map";

describe("floor map (2026-10-26)", () => {
  it("today's rota stations land on the right rooms", () => {
    const titles = ["Dough Prep", "Dough Sheeting", "Prep", "Mixing", "Building Table 1", "Building Table 2", "Ovens", "Fried Chicken", "Wrapping", "Packing"];
    expect(titles.map(areaForRotaStation)).toEqual(["dough", "dough", "prep", "mixing", "building", "building", "ovens", null, "wrapping", "packing"]);
  });
  it("Govee sensors land in their rooms", () => {
    const names = ["Walk in Fridge 2026", "Walk in freezer 2026", "Prep fridge (walk in)", "Mixing Prep 1", "Building Fridge 2", "Dough 2", "Raw Meat Fridge", "Raw Freezer", "Prep 1", "Office"];
    expect(names.map(areaForSensor)).toEqual(["product_fridge", "product_freezer", "prep_fridge", "mixing", "building", "dough", "raw", "raw", "prep", null]);
  });
  it("short names", () => {
    expect(shortName("Bohdan Davydov")).toBe("Bohdan D.");
    expect(shortName("Major Sarai")).toBe("Major S.");
    expect(shortName("Cher")).toBe("Cher");
  });
  it("every area sits on the plan and none overlap", () => {
    for (const a of AREAS) {
      const [x, y, w, h] = a.rect;
      expect(x >= 0 && y >= 0 && x + w <= PLAN_W && y + h <= PLAN_H, a.id).toBe(true);
    }
    for (let i = 0; i < AREAS.length; i++) for (let j = i + 1; j < AREAS.length; j++) {
      const [ax, ay, aw, ah] = AREAS[i].rect, [bx, by, bw, bh] = AREAS[j].rect;
      const overlap = ax < bx + bw - 1 && bx < ax + aw - 1 && ay < by + bh - 1 && by < ay + ah - 1;
      expect(overlap, `${AREAS[i].id} × ${AREAS[j].id}`).toBe(false);
    }
  });
});

describe("map layers", () => {
  it("defaults: names, people and paces on; sensors off", () => {
    expect(mergeLayers(null)).toEqual({ drawing: true, labels: true, people: true, kpis: true, sensors: false });
  });
  it("saved choices win; unknown keys and bad values are ignored", () => {
    expect(mergeLayers({ labels: false, sensors: true, gone: true, people: "yes" })).toEqual({ drawing: true, labels: false, people: true, kpis: true, sensors: true });
  });
});
