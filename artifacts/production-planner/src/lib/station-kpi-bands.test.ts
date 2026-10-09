import { describe, expect, it } from "vitest";
import {
  kpiBand, coreTileStatuses, CORE_TILE_ORDER, TILE_KPI_SOURCE,
  MIN_ACTIVE_MINUTES, RUN_RATE_STANDARD, WRAPPING_STANDARD_PACKS_PER_HOUR,
} from "./station-kpi-bands";

const live = (rate: number | null, activeMinutes: number | null = 120) => ({ rate, activeMinutes });

describe("kpiBand — the 20 batches/hr run rate", () => {
  it("standard is 20/hr", () => expect(RUN_RATE_STANDARD).toBe(20));
  it("exact boundaries: 22 platinum, 20 green, 18 amber", () => {
    expect(kpiBand(live(22), 20)).toBe("platinum");
    expect(kpiBand(live(21.99), 20)).toBe("green");
    expect(kpiBand(live(20), 20)).toBe("green");
    expect(kpiBand(live(19.99), 20)).toBe("amber");
    expect(kpiBand(live(18), 20)).toBe("amber");
    expect(kpiBand(live(17.99), 20)).toBe("red");
    expect(kpiBand(live(8), 20)).toBe("red");
    expect(kpiBand(live(30), 20)).toBe("platinum");
  });
});

describe("kpiBand — other standards use the same ratios", () => {
  it("wrapping 180 packs/hr: 198 / 180 / 162", () => {
    expect(WRAPPING_STANDARD_PACKS_PER_HOUR).toBe(180);
    expect(kpiBand(live(198), 180)).toBe("platinum");
    expect(kpiBand(live(197), 180)).toBe("green");
    expect(kpiBand(live(180), 180)).toBe("green");
    expect(kpiBand(live(162), 180)).toBe("amber");
    expect(kpiBand(live(161), 180)).toBe("red");
  });
  it("odd standard (7): 7.7 / 7 / 6.3", () => {
    expect(kpiBand(live(7.7), 7)).toBe("platinum");
    expect(kpiBand(live(6.3), 7)).toBe("amber");
    expect(kpiBand(live(6.29), 7)).toBe("red");
  });
});

describe("kpiBand — no data / too early is neutral, never red", () => {
  it("no standard", () => {
    expect(kpiBand(live(5), null)).toBe("neutral");
    expect(kpiBand(live(5), 0)).toBe("neutral");
  });
  it("no reading or no rate", () => {
    expect(kpiBand(null, 20)).toBe("neutral");
    expect(kpiBand(live(null), 20)).toBe("neutral");
    expect(kpiBand(live(0), 20)).toBe("neutral");
  });
  it(`under ${MIN_ACTIVE_MINUTES} active minutes`, () => {
    expect(kpiBand(live(5, MIN_ACTIVE_MINUTES - 1), 20)).toBe("neutral");
    expect(kpiBand(live(5, null), 20)).toBe("neutral");
    expect(kpiBand(live(5, MIN_ACTIVE_MINUTES), 20)).toBe("red");
  });
});

describe("coreTileStatuses", () => {
  it("mixing, sheeting and ovens follow building's run-rate colour", () => {
    for (const rate of [23, 20.4, 19, 12]) {
      const s = coreTileStatuses({ run_rate: live(rate) });
      expect(s.mixing).toEqual(s.building);
      expect(s.dough_sheeting).toEqual(s.building);
      expect(s.ovens).toEqual(s.building);
    }
    expect(coreTileStatuses({ run_rate: live(20.4) }).building.band).toBe("green");
  });
  it("wrapping has its own KPI, independent of the line", () => {
    const s = coreTileStatuses({ run_rate: live(12), wrapping: live(200) });
    expect(s.building.band).toBe("red");
    expect(s.wrapping.band).toBe("platinum");
  });
  it("packing is judged against 50 orders/hr", () => {
    expect(coreTileStatuses({ packing: live(50) }).packing.band).toBe("green");
    expect(coreTileStatuses({ packing: live(45) }).packing.band).toBe("amber");
    expect(coreTileStatuses({ packing: live(44.9) }).packing.band).toBe("red");
    expect(coreTileStatuses({ packing: live(55) }).packing.band).toBe("platinum");
  });
  it("dough prep and prepping for have no KPI", () => {
    const s = coreTileStatuses({ run_rate: live(25), wrapping: live(200) });
    expect(s.dough_prep.band).toBe("neutral");
    expect(s.prep.band).toBe("neutral");
    expect(TILE_KPI_SOURCE.dough_prep).toBeNull();
    expect(TILE_KPI_SOURCE.prep).toBeNull();
  });
  it("label states band and rate vs standard", () => {
    expect(coreTileStatuses({ run_rate: live(20.43) }).building.label).toBe("On standard — 20.4/hr vs 20/hr");
    expect(coreTileStatuses({ run_rate: live(17.2) }).ovens.label).toBe("Going too slow — 17.2/hr vs 20/hr");
  });
  it("bands on the rate as shown: 21.96 shows 22.0, so platinum", () => {
    expect(coreTileStatuses({ run_rate: live(21.96) }).building.band).toBe("platinum");
  });
  it("too early says so rather than colouring", () => {
    const s = coreTileStatuses({ run_rate: live(9, 10) });
    expect(s.building.band).toBe("neutral");
    expect(s.building.label).toMatch(/not enough data yet/);
  });
});

describe("CORE_TILE_ORDER", () => {
  it("top row Dough Prep, Prepping For, Packing, Wrapping; bottom row Mixing, Sheeting, Building, Ovens", () => {
    expect(CORE_TILE_ORDER).toEqual([
      "dough_prep", "prep", "packing", "wrapping",
      "mixing", "dough_sheeting", "building", "ovens",
    ]);
  });
  it("the bottom row is exactly the run-rate line", () => {
    expect(CORE_TILE_ORDER.slice(4).every(k => TILE_KPI_SOURCE[k] === "run_rate")).toBe(true);
    expect(CORE_TILE_ORDER.slice(0, 4).some(k => TILE_KPI_SOURCE[k] === "run_rate")).toBe(false);
  });
});
