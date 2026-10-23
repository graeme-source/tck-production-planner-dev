import { describe, it, expect } from "vitest";
import { madeByLine, deriveDay, FALLBACK_SETTINGS, type DayComponents, type PlanItemInput, type TeSettings } from "./team-efficiency-day";

// Category names here are test data, standing in for whatever the recipes
// table holds — the module itself knows none of them.
const LINE_A = "Line A (2-packs at the fridge)";
const LINE_B = "Line B (counted in batches)";
const LINE_C = "Line C (planned, never counted)";

const settings: TeSettings = {
  ...FALLBACK_SETTINGS,
  standardRatio: 4,
  despatchShare: 0.1,
  discountRates: { [LINE_A]: 0.2, [LINE_B]: 0.05 },
  eightPackFactor: 0.72,
  linePositions: { [LINE_B]: ["Frying", "breading"] },
};

const item = (p: Partial<PlanItemInput>): PlanItemInput => ({
  category: LINE_A, fridgeQty: 0, eightPackBags: 0, batchesTarget: 0, batchesComplete: 0,
  portionsPerBatch: 10, packSize: 2, rrp: 10, ...p,
});

const comps = (p: Partial<DayComponents>): DayComponents => ({
  date: "2026-09-22", made: {}, despatched: {}, ordersDespatched: 0,
  labourCostTotal: 1000, lineLabour: {}, paidHours: 60, headcount: 8, pendingShifts: 0, ignoredUnapproved: 0, ...p,
});

describe("madeByLine", () => {
  it("counts fridge 2-packs and values 8-pack bags as 8 ÷ pack size packs", () => {
    const m = madeByLine([item({ fridgeQty: 100, eightPackBags: 2, batchesTarget: 10, batchesComplete: 99 })]);
    expect(m[LINE_A].packs).toBe(100);
    expect(m[LINE_A].gross).toBe(1000);
    expect(m[LINE_A].bags).toBe(2);
    expect(m[LINE_A].bagGross).toBe(2 * 4 * 10);
    expect(m[LINE_A].fromBatches).toBe(false); // fridge counts win; batches ignored
    expect(m[LINE_A].plannedBatches).toBe(10);
  });

  it("uses completed batches for a line with no fridge count at all", () => {
    const m = madeByLine([
      item({ category: LINE_B, batchesTarget: 36, batchesComplete: 36, portionsPerBatch: 1, packSize: 1, rrp: 12.95 }),
      item({ category: LINE_B, batchesTarget: 15, batchesComplete: 11, portionsPerBatch: 1, packSize: 1, rrp: 33.5 }),
    ]);
    expect(m[LINE_B].packs).toBe(47);
    expect(m[LINE_B].gross).toBeCloseTo(36 * 12.95 + 11 * 33.5, 6);
    expect(m[LINE_B].fromBatches).toBe(true);
  });

  it("ignores items with no category and never counts freezer wonkies", () => {
    const m = madeByLine([item({ category: null, fridgeQty: 50 })]);
    expect(Object.keys(m)).toHaveLength(0);
  });
});

describe("deriveDay", () => {
  it("credits made and despatched value at the fixed discount and divides by labour", () => {
    const made = madeByLine([item({ fridgeQty: 400, eightPackBags: 1, batchesTarget: 40 })]);
    const d = deriveDay(comps({
      made,
      despatched: { [LINE_A]: { packs: 300, gross: 3000, bagPacks: 4, bagGross: 40 } },
      ordersDespatched: 100,
    }), settings);
    const madeNet = 4000 * 0.8 + 40 * 0.72;
    const despNet = 3000 * 0.8 + 40 * 0.72;
    expect(d.valueMadeNet).toBeCloseTo(madeNet, 6);
    expect(d.valueDespatchedNet).toBeCloseTo(despNet, 6);
    expect(d.valueCredited).toBeCloseTo(0.9 * madeNet + 0.1 * despNet, 6);
    expect(d.ratio).toBeCloseTo(d.valueCredited / 1000, 6);
    expect(d.efficiencyPct).toBeCloseTo((d.valueCredited / 1000 / 4) * 100, 6);
    expect(d.status).toBe("ok");
    expect(d.packsByLine[LINE_A]).toBe(400);
    expect(d.packsDespatched).toBe(304);
  });

  it("flags and excludes a day when a planned line has nothing counted (21 Aug 2026 shape)", () => {
    // Desserts planned (24 batches), none counted; the main line didn't run.
    const made = madeByLine([
      item({ category: LINE_C, batchesTarget: 24, batchesComplete: 0, portionsPerBatch: 48, packSize: 6 }),
      item({ category: LINE_A, fridgeQty: 17, batchesTarget: 2 }),
    ]);
    const d = deriveDay(comps({ made, labourCostTotal: 759 }), settings);
    expect(d.status).toBe("excluded");
    expect(d.excluded).toBe(true);
    expect(d.efficiencyPct).toBeNull();
    expect(d.flags.map(f => f.code)).toContain("uncounted_output");
    expect(d.flags.find(f => f.code === "uncounted_output")?.line).toBe(LINE_C);
  });

  it("flags and excludes a line counted at well under half its plan (a half-done count sheet)", () => {
    // 2 Apr 2026 shape: 80 batches planned (400 packs), 50 packs counted.
    const made = madeByLine([item({ fridgeQty: 50, batchesTarget: 80 })]);
    const d = deriveDay(comps({ made }), settings);
    expect(d.status).toBe("excluded");
    expect(d.flags.map(f => f.code)).toEqual(["partly_counted"]);
    expect(d.flags[0].message).toContain("50 of 400");
  });

  it("does not flag a small shortfall or a line counted at half its plan or more", () => {
    // 17 of 35 mac packs: under half, but only 18 short.
    const small = deriveDay(comps({ made: madeByLine([item({ fridgeQty: 17, batchesTarget: 35, portionsPerBatch: 2, packSize: 2 })]) }), settings);
    expect(small.status).toBe("ok");
    // 211 of 375: short, but more than half counted — could be a real bad day.
    const half = deriveDay(comps({ made: madeByLine([item({ fridgeQty: 211, batchesTarget: 75 })]) }), settings);
    expect(half.status).toBe("ok");
    // 8-pack bags count towards the line: 150 packs + 20 bags (80 packs) of 400 planned.
    const bags = deriveDay(comps({ made: madeByLine([item({ fridgeQty: 150, eightPackBags: 20, batchesTarget: 80 })]) }), settings);
    expect(bags.status).toBe("ok");
  });

  it("flags a planned-but-uncounted batch line rather than taking its staff's pay off", () => {
    const made = madeByLine([item({ category: LINE_B, batchesTarget: 80, batchesComplete: 0, portionsPerBatch: 1, packSize: 1 })]);
    const d = deriveDay(comps({ made, lineLabour: { [LINE_B]: 200 } }), settings);
    expect(d.status).toBe("excluded");
    expect(d.labourCost).toBe(1000);
    expect(d.flags.map(f => f.code)).not.toContain("line_pay_removed");
  });

  it("takes line-only pay off a day that line wasn't in the planner", () => {
    const made = madeByLine([item({ fridgeQty: 360, batchesTarget: 36 })]);
    const d = deriveDay(comps({ made, labourCostTotal: 1200, lineLabour: { [LINE_B]: 150 } }), settings);
    expect(d.labourCost).toBe(1050);
    expect(d.status).toBe("ok");
    expect(d.flags.map(f => f.code)).toEqual(["line_pay_removed"]);
  });

  it("keeps line-only pay when that line ran and was counted", () => {
    const made = madeByLine([
      item({ fridgeQty: 540, batchesTarget: 54 }),
      item({ category: LINE_B, batchesTarget: 36, batchesComplete: 36, portionsPerBatch: 1, packSize: 1 }),
    ]);
    const d = deriveDay(comps({ made, labourCostTotal: 1500, lineLabour: { [LINE_B]: 300 } }), settings);
    expect(d.labourCost).toBe(1500);
    expect(d.flags).toHaveLength(0);
  });

  it("shows nothing until every shift is approved", () => {
    const made = madeByLine([item({ fridgeQty: 400, batchesTarget: 40 })]);
    const d = deriveDay(comps({ made, pendingShifts: 2 }), settings);
    expect(d.status).toBe("pending");
    expect(d.ratio).toBeNull();
    expect(d.efficiencyPct).toBeNull();
    expect(d.flags[0].code).toBe("pending_approval");
  });

  it("counts a day with stale never-approved shifts but says so", () => {
    const made = madeByLine([item({ fridgeQty: 400, batchesTarget: 40 })]);
    const d = deriveDay(comps({ made, ignoredUnapproved: 1 }), settings);
    expect(d.status).toBe("ok");
    expect(d.flags.map(f => f.code)).toEqual(["unapproved_ignored"]);
  });

  it("has no ratio when nobody productive was paid", () => {
    const made = madeByLine([item({ fridgeQty: 10, batchesTarget: 1 })]);
    const d = deriveDay(comps({ made, labourCostTotal: 0 }), settings);
    expect(d.status).toBe("no_labour");
    expect(d.ratio).toBeNull();
  });

  it("treats a line with no discount rate as full price", () => {
    const made = madeByLine([item({ category: "Unrated", fridgeQty: 10, batchesTarget: 1 })]);
    const d = deriveDay(comps({ made }), settings);
    expect(d.valueMadeNet).toBe(100);
  });

  it("flag messages never carry pounds", () => {
    const made = madeByLine([item({ category: LINE_C, batchesTarget: 5 })]);
    const d = deriveDay(comps({ made, lineLabour: { [LINE_B]: 150 }, ignoredUnapproved: 2, pendingShifts: 1 }), settings);
    for (const f of d.flags) expect(f.message).not.toMatch(/£|\d+\.\d{2}/);
  });
});

// Regression (Graeme, 23 Oct 2026): on Tue 20 Oct 18 batches of a
// freezer-stored, skip-ovens product (48 portions a batch, packs of 6,
// RRP £11.95) were wrapped straight into the freezer — freezer_qty 144,
// fridge_qty 0, batches_complete 0. madeByLine read only fridge counts, so
// the line made nothing while its labour was counted: the day showed 53%.
// Freezer-stored products now count their freezer packs; a fridge-stored
// product's freezer_qty (wonkies) is still ignored.
describe("freezer-stored products (20 Oct 2026 regression)", () => {
  const FRIDGE_LINE = "Fridge line (2-packs)";
  const SMALL_LINE = "Second fridge line";
  const FREEZER_LINE = "Freezer line (packs of 6)";
  // Tuesday's real settings and stored components.
  const tue: TeSettings = {
    ...FALLBACK_SETTINGS,
    standardRatio: 4.78,
    despatchShare: 0.11,
    discountRates: { [FRIDGE_LINE]: 0.22, [FREEZER_LINE]: 0.023, [SMALL_LINE]: 0.039 },
    linePositions: {},
  };
  const fridgeRows: PlanItemInput[] = [
    // The fridge line's day as one row: 239 packs, £3,604.55 at RRP, plus
    // 30 freezer wonkies that must NOT count.
    item({ category: FRIDGE_LINE, fridgeQty: 239, freezerQty: 30, freezerStored: false, batchesTarget: 50, rrp: 3604.55 / 239 }),
    item({ category: SMALL_LINE, fridgeQty: 32, batchesTarget: 30, portionsPerBatch: 2, packSize: 2, rrp: 410.4 / 32 }),
  ];
  const freezerItem = item({
    category: FREEZER_LINE, fridgeQty: 0, freezerQty: 144, freezerStored: true,
    batchesTarget: 18, batchesComplete: 0, portionsPerBatch: 48, packSize: 6, rrp: 11.95,
  });
  // Tuesday's stored despatch: £4,419.94 net, valued here on the fridge line.
  const tuesday = (made: ReturnType<typeof madeByLine>) => deriveDay(comps({
    date: "2026-10-20", made, labourCostTotal: 1327.5,
    despatched: { [FRIDGE_LINE]: { packs: 358, gross: 4419.94 / (1 - 0.22), bagPacks: 0, bagGross: 0 } },
  }), tue);

  it("counts a freezer-stored product's freezer packs as packs made", () => {
    const m = madeByLine([freezerItem]);
    expect(m[FREEZER_LINE].packs).toBe(144);
    expect(m[FREEZER_LINE].gross).toBeCloseTo(144 * 11.95, 6);
    expect(m[FREEZER_LINE].plannedPacks).toBe(144); // 18 × 48 ÷ 6
    expect(m[FREEZER_LINE].fromBatches).toBe(false);
  });

  it("still ignores a fridge-stored product's freezer wonkies", () => {
    const m = madeByLine(fridgeRows);
    expect(m[FRIDGE_LINE].packs).toBe(239);
    expect(m[FRIDGE_LINE].gross).toBeCloseTo(3604.55, 6);
  });

  it("Tuesday: the 144 freezer packs lift the day from 53% to 76%", () => {
    const before = tuesday(madeByLine(fridgeRows));
    expect(before.valueMadeNet).toBeCloseTo(3205.94, 1);
    expect(before.efficiencyPct!).toBeCloseTo(52.63, 1);
    expect(before.packsByLine[FREEZER_LINE]).toBeUndefined();

    const after = tuesday(madeByLine([...fridgeRows, freezerItem]));
    expect(after.status).toBe("ok");
    expect(after.packsByLine[FREEZER_LINE]).toBe(144);
    expect(after.valueMadeNet).toBeCloseTo(3205.94 + 144 * 11.95 * (1 - 0.023), 1);
    expect(after.efficiencyPct!).toBeCloseTo(76.21, 1);
  });

  it("a freezer-stored product with nothing wrapped is still flagged as uncounted", () => {
    const d = tuesday(madeByLine([...fridgeRows, { ...freezerItem, freezerQty: 0 }]));
    expect(d.flags.some(f => f.code === "uncounted_output" && f.line === FREEZER_LINE)).toBe(true);
  });
});
