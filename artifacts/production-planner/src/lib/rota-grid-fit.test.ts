import { describe, it, expect } from "vitest";
import { chooseRotaGridLayout, rotaGridHeight, ROTA_DENSITIES, ROTA_GRID_GAP } from "./rota-grid-fit";

const ones = (n: number) => Array.from({ length: n }, () => 1);

describe("rotaGridHeight", () => {
  it("sums one row per `columns` cards plus the gaps between rows", () => {
    const b = ROTA_DENSITIES.compact.base;
    expect(rotaGridHeight(ones(6), 3, "compact")).toBe(2 * b + ROTA_GRID_GAP);
    expect(rotaGridHeight(ones(7), 3, "compact")).toBe(3 * b + 2 * ROTA_GRID_GAP);
  });
  it("a card with two people makes its whole row taller", () => {
    const { base, perPerson } = ROTA_DENSITIES.roomy;
    expect(rotaGridHeight([1, 2, 1, 1], 2, "roomy")).toBe(base + perPerson + base + ROTA_GRID_GAP);
  });
  it("is zero with nobody on", () => {
    expect(rotaGridHeight([], 2, "roomy")).toBe(0);
  });
});

describe("chooseRotaGridLayout", () => {
  it("keeps big cards in two columns when there's plenty of room (big screen, 8 people)", () => {
    expect(chooseRotaGridLayout({ peoplePerCard: ones(8), availableWidth: 1800, availableHeight: 700 }))
      .toEqual({ columns: 2, density: "roomy", fits: true });
  });
  it("goes to three columns before shrinking the type", () => {
    // 12 cards: 2 cols roomy = 6 rows (too tall for 450), 3 cols roomy = 4 rows = 424.
    expect(chooseRotaGridLayout({ peoplePerCard: ones(12), availableWidth: 1300, availableHeight: 450 }))
      .toEqual({ columns: 3, density: "roomy", fits: true });
  });
  it("drops to compact cards when three roomy columns still don't fit (iPad 1024×768, 12 people)", () => {
    expect(chooseRotaGridLayout({ peoplePerCard: ones(12), availableWidth: 990, availableHeight: 380 }))
      .toEqual({ columns: 3, density: "compact", fits: true });
  });
  it("tries a 4th column of compact cards before shrinking to tight ones (1440×900, 16 people)", () => {
    const people = [2, ...ones(15)];
    expect(chooseRotaGridLayout({ peoplePerCard: people, availableWidth: 1390, availableHeight: 536 }))
      .toEqual({ columns: 4, density: "compact", fits: true });
  });
  it("never puts big roomy cards in more than three columns", () => {
    const l = chooseRotaGridLayout({ peoplePerCard: ones(12), availableWidth: 1900, availableHeight: 340 });
    expect(l.density === "roomy" ? l.columns <= 3 : true).toBe(true);
    expect(l).toEqual({ columns: 4, density: "compact", fits: true });
  });
  it("uses a single column for a tiny team", () => {
    expect(chooseRotaGridLayout({ peoplePerCard: ones(3), availableWidth: 1200, availableHeight: 600 }).columns).toBe(1);
  });
  it("never asks for more columns than the width can hold", () => {
    const l = chooseRotaGridLayout({ peoplePerCard: ones(9), availableWidth: 500, availableHeight: 2000 });
    expect(l.columns).toBe(1);
    expect(l.fits).toBe(true);
  });
  it("falls back to four tight columns for 20+ people rather than scrolling", () => {
    const l = chooseRotaGridLayout({ peoplePerCard: ones(22), availableWidth: 1100, availableHeight: 360 });
    expect(l).toEqual({ columns: 4, density: "tight", fits: true });
  });
  it("goes wider than four on a wide screen when four still overflows", () => {
    const l = chooseRotaGridLayout({ peoplePerCard: ones(30), availableWidth: 1800, availableHeight: 300 });
    expect(l.density).toBe("tight");
    expect(l.columns).toBeGreaterThan(4);
    expect(l.fits).toBe(true);
  });
  it("reports fits: false only when nothing at all fits", () => {
    const l = chooseRotaGridLayout({ peoplePerCard: ones(40), availableWidth: 800, availableHeight: 100 });
    expect(l.fits).toBe(false);
    expect(l.density).toBe("tight");
  });
  it("squeeze steps to the next option when the real grid overflowed", () => {
    const base = { peoplePerCard: ones(8), availableWidth: 1800, availableHeight: 700 };
    expect(chooseRotaGridLayout({ ...base, squeeze: 1 })).toEqual({ columns: 3, density: "roomy", fits: true });
    expect(chooseRotaGridLayout({ ...base, squeeze: 2 }).density).toBe("compact");
  });
  it("handles an empty rota", () => {
    expect(chooseRotaGridLayout({ peoplePerCard: [], availableWidth: 1000, availableHeight: 500 }))
      .toEqual({ columns: 1, density: "roomy", fits: true });
  });
});
