import { describe, it, expect } from "vitest";
import {
  compareBins,
  earliestBin,
  comparePickWalk,
  sortByPickOrder,
  FALLBACK_ZONE_ORDER,
  type PickBin,
} from "./pick-order";

const DEFAULT: string[] = ["fridge", "freezer", "ambient"];

const bin = (zone: string, door?: number | null, shelf?: string | null): PickBin =>
  ({ zone, door: door ?? null, shelf: shelf ?? null });

describe("compareBins — the walk", () => {
  it("follows the configured zone order, not a hard-coded one", () => {
    const fridge = bin("fridge", 1, "A");
    const freezer = bin("freezer", 8, "A");
    expect(compareBins(fridge, freezer, ["fridge", "freezer", "ambient"])).toBeLessThan(0);
    // Drag the freezer first on Bin Locations and the walk flips.
    expect(compareBins(fridge, freezer, ["freezer", "fridge", "ambient"])).toBeGreaterThan(0);
  });

  it("goes door by door inside a zone", () => {
    expect(compareBins(bin("fridge", 2, "A"), bin("fridge", 5, "A"), DEFAULT)).toBeLessThan(0);
  });

  it("goes shelf by shelf inside a door, A at the top", () => {
    expect(compareBins(bin("fridge", 3, "A"), bin("fridge", 3, "C"), DEFAULT)).toBeLessThan(0);
  });

  it("sorts a bin with no door after one that has a door in the same zone", () => {
    expect(compareBins(bin("ambient", 1, "A"), bin("ambient", null, null), DEFAULT)).toBeLessThan(0);
  });

  it("sorts no bin at all last, and calls two no-bins equal", () => {
    expect(compareBins(null, bin("ambient"), DEFAULT)).toBeGreaterThan(0);
    expect(compareBins(bin("ambient"), null, DEFAULT)).toBeLessThan(0);
    expect(compareBins(null, null, DEFAULT)).toBe(0);
    expect(compareBins(undefined, null, DEFAULT)).toBe(0);
  });

  it("calls the same bin equal, so a stable sort leaves the caller's order alone", () => {
    expect(compareBins(bin("fridge", 3, "B"), bin("fridge", 3, "B"), DEFAULT)).toBe(0);
  });

  // Pinned, not endorsed: indexOf returns -1 for a zone missing from the
  // configured order, which puts it first. This is the behaviour Order
  // Packing Live has always had; the zone list is a three-value enum and the
  // Bin Locations page only reorders what it was given, so the UI cannot
  // reach it. Documented here so a future change to it is a deliberate one.
  it("puts a zone missing from the config first (historic behaviour, pinned)", () => {
    expect(compareBins(bin("ambient", 1, "A"), bin("fridge", 1, "A"), ["fridge", "freezer"])).toBeLessThan(0);
  });
});

describe("earliestBin — where you first meet a recipe", () => {
  it("takes the earlier of two bins in different zones", () => {
    const bins = [bin("freezer", 8, "A"), bin("fridge", 6, "D")];
    expect(earliestBin(bins, DEFAULT)).toEqual(bin("fridge", 6, "D"));
  });

  it("takes the earlier door when a recipe's variants span two fridge doors", () => {
    // A 2-pack on door 5 and the 8-pack bag on door 2 — you meet the recipe
    // at door 2.
    const bins = [bin("fridge", 5, "B"), bin("fridge", 2, "C")];
    expect(earliestBin(bins, DEFAULT)).toEqual(bin("fridge", 2, "C"));
  });

  it("takes the higher shelf when both variants are behind the same door", () => {
    const bins = [bin("fridge", 4, "D"), bin("fridge", 4, "A")];
    expect(earliestBin(bins, DEFAULT)).toEqual(bin("fridge", 4, "A"));
  });

  it("follows the configured zone order when picking the earliest", () => {
    const bins = [bin("freezer", 8, "A"), bin("fridge", 6, "D")];
    expect(earliestBin(bins, ["freezer", "fridge", "ambient"])).toEqual(bin("freezer", 8, "A"));
  });

  it("returns null when none of the variants have a bin", () => {
    expect(earliestBin([], DEFAULT)).toBeNull();
    expect(earliestBin(null, DEFAULT)).toBeNull();
    expect(earliestBin([null, undefined], DEFAULT)).toBeNull();
  });

  it("ignores the unbinned variants when at least one has a bin", () => {
    expect(earliestBin([null, bin("fridge", 3, "B"), undefined], DEFAULT)).toEqual(bin("fridge", 3, "B"));
  });
});

describe("sortByPickOrder — recipe rows", () => {
  interface Row { name: string; bins: PickBin[] }
  const binsOf = (r: Row) => r.bins;

  it("walks the recipes door by door", () => {
    const rows: Row[] = [
      { name: "Pepperoni", bins: [bin("fridge", 5, "A")] },
      { name: "Margherita", bins: [bin("fridge", 1, "C")] },
      { name: "Philly", bins: [bin("fridge", 1, "A")] },
    ];
    expect(sortByPickOrder(rows, binsOf, DEFAULT).map(r => r.name))
      .toEqual(["Philly", "Margherita", "Pepperoni"]);
  });

  it("puts a recipe at the earliest bin among its variants", () => {
    const rows: Row[] = [
      // Chorizo's 2-pack is on door 6, but its 8-pack bag is on door 1 —
      // so you meet it at door 1, before the door-3 recipe.
      { name: "Chorizo", bins: [bin("fridge", 6, "B"), bin("fridge", 1, "A")] },
      { name: "Mac Cheese", bins: [bin("fridge", 3, "A")] },
    ];
    expect(sortByPickOrder(rows, binsOf, DEFAULT).map(r => r.name))
      .toEqual(["Chorizo", "Mac Cheese"]);
  });

  it("sorts recipes with no bin LAST, keeping their existing relative order", () => {
    const rows: Row[] = [
      { name: "No bin B", bins: [] },
      { name: "Freezer", bins: [bin("freezer", 8, "A")] },
      { name: "No bin A", bins: [] },
      { name: "Fridge", bins: [bin("fridge", 2, "A")] },
    ];
    expect(sortByPickOrder(rows, binsOf, DEFAULT).map(r => r.name))
      .toEqual(["Fridge", "Freezer", "No bin B", "No bin A"]);
  });

  it("hides nothing — every row comes back", () => {
    const rows: Row[] = [
      { name: "a", bins: [] },
      { name: "b", bins: [bin("fridge", 1, "A")] },
      { name: "c", bins: [bin("ambient")] },
    ];
    expect(sortByPickOrder(rows, binsOf, DEFAULT)).toHaveLength(3);
  });

  it("keeps two recipes sharing one bin in the order they arrived (SKU order)", () => {
    const rows: Row[] = [
      { name: "sku 3a", bins: [bin("fridge", 4, "B")] },
      { name: "sku 3b", bins: [bin("fridge", 4, "B")] },
      { name: "sku 3c", bins: [bin("fridge", 4, "B")] },
    ];
    expect(sortByPickOrder(rows, binsOf, DEFAULT).map(r => r.name))
      .toEqual(["sku 3a", "sku 3b", "sku 3c"]);
  });

  it("re-walks when an admin reorders the zones", () => {
    const rows: Row[] = [
      { name: "Fridge", bins: [bin("fridge", 1, "A")] },
      { name: "Freezer", bins: [bin("freezer", 8, "A")] },
    ];
    expect(sortByPickOrder(rows, binsOf, ["freezer", "fridge", "ambient"]).map(r => r.name))
      .toEqual(["Freezer", "Fridge"]);
  });
});

// ─── Order Packing Live equivalence ──────────────────────────────────────
//
// The comparator below is a VERBATIM copy of the one that lived inline in
// pages/fulfilment.tsx (`sortedLineItems`) before it was extracted. It is
// kept here purely as the oracle: the extracted comparePickWalk must order
// every one of the cases below identically. Order Packing Live is used on
// every dispatch day, so "no behaviour change" has to be shown, not claimed.

interface OracleItem {
  id: number;
  title: string;
  sku: string;
  location: { zone: string; door?: number | null; shelf?: string | null } | null;
}

function originalComparator(a: OracleItem, b: OracleItem, zonePickOrder: string[]): number {
  const idxA = a.location ? zonePickOrder.indexOf(a.location.zone) : zonePickOrder.length;
  const idxB = b.location ? zonePickOrder.indexOf(b.location.zone) : zonePickOrder.length;
  if (idxA !== idxB) return idxA - idxB;
  const doorA = a.location?.door ?? Number.MAX_SAFE_INTEGER;
  const doorB = b.location?.door ?? Number.MAX_SAFE_INTEGER;
  if (doorA !== doorB) return doorA - doorB;
  const shelfA = a.location?.shelf ?? "ZZ";
  const shelfB = b.location?.shelf ?? "ZZ";
  if (shelfA !== shelfB) return shelfA.localeCompare(shelfB);
  if (a.sku && !b.sku) return -1;
  if (!a.sku && b.sku) return 1;
  if (a.sku && b.sku) return a.sku.localeCompare(b.sku, undefined, { numeric: true });
  return a.title.localeCompare(b.title);
}

/** A representative order: binned and unbinned, both zones, the ambient
 *  tray, legacy free-text locations with no door/shelf, shared bins, SKU
 *  natural-sort pairs, and items with no SKU at all. */
const REPRESENTATIVE: OracleItem[] = [
  { id: 1, title: "Buttermilk Chicken 2pk", sku: "1", location: { zone: "fridge", door: 3, shelf: "B" } },
  { id: 2, title: "Korean Strips 2pk", sku: "3c", location: { zone: "fridge", door: 3, shelf: "B" } },
  { id: 3, title: "Margherita", sku: "3b", location: { zone: "fridge", door: 3, shelf: "B" } },
  { id: 4, title: "Philly Cheesesteak", sku: "10", location: { zone: "fridge", door: 1, shelf: "A" } },
  { id: 5, title: "Mac Cheese", sku: "5b", location: { zone: "fridge", door: 7, shelf: "E" } },
  { id: 6, title: "Frozen Dough", sku: "20", location: { zone: "freezer", door: 8, shelf: "C" } },
  { id: 7, title: "Frozen Sauce", sku: "21", location: { zone: "freezer", door: 9, shelf: "A" } },
  { id: 8, title: "Recipe Card", sku: "", location: { zone: "ambient", door: null, shelf: null } },
  { id: 9, title: "Sticker Sheet", sku: "", location: null },
  { id: 10, title: "Tote Bag", sku: "99", location: null },
  // Legacy free-text location: a zone but no bin.
  { id: 11, title: "Chilli Oil", sku: "7", location: { zone: "ambient", door: null, shelf: null } },
  { id: 12, title: "BBQ Pulled Pork", sku: "5c", location: { zone: "fridge", door: 7, shelf: "E" } },
  { id: 13, title: "Insert Card", sku: "", location: { zone: "ambient", door: null, shelf: null } },
  { id: 14, title: "8-pack Bag", sku: "1", location: { zone: "fridge", door: 1, shelf: "A" } },
  { id: 15, title: "Wonky Box", sku: "2", location: { zone: "fridge", door: 1, shelf: "D" } },
];

describe("Order Packing Live equivalence", () => {
  const configs: Array<{ label: string; zoneOrder: string[] }> = [
    { label: "default fridge → freezer → ambient", zoneOrder: ["fridge", "freezer", "ambient"] },
    { label: "freezer first", zoneOrder: ["freezer", "fridge", "ambient"] },
    { label: "ambient first", zoneOrder: ["ambient", "fridge", "freezer"] },
    { label: "the pre-config fallback", zoneOrder: [...FALLBACK_ZONE_ORDER] },
  ];

  for (const { label, zoneOrder } of configs) {
    it(`orders the representative picking list identically — ${label}`, () => {
      const before = [...REPRESENTATIVE].sort((a, b) => originalComparator(a, b, zoneOrder));
      const after = [...REPRESENTATIVE].sort((a, b) => comparePickWalk(a, b, zoneOrder));
      expect(after.map(i => i.id)).toEqual(before.map(i => i.id));
    });
  }

  it("agrees on every ordered pair, in both directions", () => {
    for (const { zoneOrder } of configs) {
      for (const a of REPRESENTATIVE) {
        for (const b of REPRESENTATIVE) {
          expect(Math.sign(comparePickWalk(a, b, zoneOrder)))
            .toBe(Math.sign(originalComparator(a, b, zoneOrder)));
        }
      }
    }
  });

  it("agrees from any starting order — the sort is not luck of the input", () => {
    const zoneOrder = ["fridge", "freezer", "ambient"];
    // Deterministic shuffles, so a failure is reproducible.
    for (let seed = 1; seed <= 20; seed++) {
      const shuffled = [...REPRESENTATIVE].sort((a, b) => ((a.id * seed) % 17) - ((b.id * seed) % 17));
      const before = [...shuffled].sort((a, b) => originalComparator(a, b, zoneOrder));
      const after = [...shuffled].sort((a, b) => comparePickWalk(a, b, zoneOrder));
      expect(after.map(i => i.id)).toEqual(before.map(i => i.id));
    }
  });

  it("keeps the SKU natural sort inside a shared bin (1, 3b, 3c — not 1, 3b, 3c as strings)", () => {
    const zoneOrder = ["fridge", "freezer", "ambient"];
    const sameBin = REPRESENTATIVE.filter(i => i.location?.door === 3);
    const sorted = [...sameBin].sort((a, b) => comparePickWalk(a, b, zoneOrder));
    expect(sorted.map(i => i.sku)).toEqual(["1", "3b", "3c"]);
  });

  it("keeps SKU-less items after SKU'd ones in the same bin", () => {
    const zoneOrder = ["fridge", "freezer", "ambient"];
    const ambient = REPRESENTATIVE.filter(i => i.location?.zone === "ambient");
    const sorted = [...ambient].sort((a, b) => comparePickWalk(a, b, zoneOrder));
    expect(sorted[0].sku).toBe("7");
    expect(sorted.slice(1).map(i => i.title)).toEqual(["Insert Card", "Recipe Card"]);
  });
});
