import { describe, it, expect } from "vitest";
import { FRIED_CHICKEN_CATEGORY, isMainKitchen } from "@workspace/production-schedule";
import {
  attributeRejectStations,
  canEditDefect,
  defectPct,
  standardPeriods,
  summariseDefects,
  type DefectTypeInput,
} from "./defects-kpi";
import { madeByLine, totalPacksMade, deriveDay, FALLBACK_SETTINGS } from "./team-efficiency-day";

const types: DefectTypeInput[] = [
  { id: 1, name: "Mislabel", active: true, sortOrder: 10 },
  { id: 2, name: "Wrong or missing item in order", active: true, sortOrder: 20 },
  { id: 3, name: "Retired type", active: false, sortOrder: 30 },
];

describe("defectPct", () => {
  it("is defects ÷ packs made to one decimal", () => {
    expect(defectPct(14, 1180)).toBe(1.2);
    expect(defectPct(0, 500)).toBe(0);
  });
  it("is null (not 0%) when nothing was made", () => {
    expect(defectPct(3, 0)).toBeNull();
  });
});

describe("summariseDefects", () => {
  it("adds wonkies, dog bins and recorded defects in packs — the 30 Sep mislabel counts 8", () => {
    const s = summariseDefects({
      from: "2026-09-30", to: "2026-09-30",
      days: [{ date: "2026-09-30", packsMade: 1180, wonky: 4, dogBin: 2 }],
      recorded: [{ occurredOn: "2026-09-30", typeId: 1, packs: 8, station: "wrapping" }],
      types,
      rejectStations: [],
    });
    expect(s.defects).toBe(14);
    expect(s.packsMade).toBe(1180);
    expect(s.pct).toBe(1.2);
    expect(s.recorded).toBe(8);
    expect(s.byType.map(t => [t.key, t.packs])).toEqual([
      ["wonky", 4], ["dog_bin", 2], ["type:1", 8], ["type:2", 0],
    ]);
  });

  it("leaves out anything outside the range and shows switched-off types only when used", () => {
    const s = summariseDefects({
      from: "2026-09-28", to: "2026-09-29",
      days: [
        { date: "2026-09-28", packsMade: 100, wonky: 1, dogBin: 0 },
        { date: "2026-09-30", packsMade: 999, wonky: 50, dogBin: 50 },
      ],
      recorded: [
        { occurredOn: "2026-09-29", typeId: 3, packs: 2, station: null },
        { occurredOn: "2026-10-01", typeId: 1, packs: 5, station: null },
      ],
      types,
      rejectStations: [],
    });
    expect(s.defects).toBe(3);
    expect(s.packsMade).toBe(100);
    expect(s.byType.find(t => t.key === "type:3")?.packs).toBe(2);
    expect(s.byDay).toEqual([
      { date: "2026-09-28", defects: 1, packsMade: 100, pct: 1 },
      { date: "2026-09-29", defects: 2, packsMade: 0, pct: null },
    ]);
  });

  it("groups by station: recorded stations plus reject taps, unknown last", () => {
    const s = summariseDefects({
      from: "2026-09-30", to: "2026-09-30",
      days: [{ date: "2026-09-30", packsMade: 200, wonky: 3, dogBin: 1 }],
      recorded: [
        { occurredOn: "2026-09-30", typeId: 1, packs: 8, station: "wrapping" },
        { occurredOn: "2026-09-30", typeId: 2, packs: 1, station: null },
      ],
      types,
      rejectStations: [{ kind: "wonky", station: "ovens", packs: 2 }],
    });
    expect(s.byStation).toEqual([
      { station: "wrapping", packs: 8 },
      { station: "ovens", packs: 2 },
      { station: null, packs: 3 }, // 1 wonky + 1 dog bin with no trail + 1 recorded
    ]);
  });
});

describe("attributeRejectStations", () => {
  it("never credits stations with more than the counters say", () => {
    expect(attributeRejectStations({ wonky: 2, dogBin: 0 }, [
      { kind: "wonky", station: "ovens", packs: 5 },
    ])).toEqual([{ station: "ovens", packs: 2 }]);
  });
  it("ignores stations whose taps were all undone", () => {
    expect(attributeRejectStations({ wonky: 1, dogBin: 0 }, [
      { kind: "wonky", station: "wrapping", packs: 0 },
    ])).toEqual([{ station: null, packs: 1 }]);
  });
});

describe("standardPeriods", () => {
  it("week starts Monday, month starts on the 1st", () => {
    expect(standardPeriods("2026-10-01")).toEqual({
      today: { from: "2026-10-01", to: "2026-10-01" },
      week: { from: "2026-09-28", to: "2026-10-01" },
      month: { from: "2026-10-01", to: "2026-10-01" },
    });
  });
});

describe("canEditDefect", () => {
  it("managers and admins can edit anything; others only their own", () => {
    expect(canEditDefect({ id: 9, role: "manager" }, { recordedById: 1 })).toBe(true);
    expect(canEditDefect({ id: 9, role: "admin" }, { recordedById: null })).toBe(true);
    expect(canEditDefect({ id: 1, role: "viewer" }, { recordedById: 1 })).toBe(true);
    expect(canEditDefect({ id: 2, role: "viewer" }, { recordedById: 1 })).toBe(false);
    expect(canEditDefect({ id: 2, role: "viewer" }, { recordedById: null })).toBe(false);
  });
});

describe("packs made is the Team efficiency figure", () => {
  it("totalPacksMade equals the sum of deriveDay's packsByLine", () => {
    const made = madeByLine([
      { category: "A", fridgeQty: 101, eightPackBags: 3, batchesTarget: 10, batchesComplete: 10, portionsPerBatch: 20, packSize: 2, rrp: 10 },
      { category: "B", fridgeQty: 0, eightPackBags: 0, batchesTarget: 3, batchesComplete: 3, portionsPerBatch: 7, packSize: 2, rrp: 8 },
    ]);
    const day = deriveDay({
      date: "2026-09-30", made, despatched: {}, ordersDespatched: 0, labourCostTotal: 100, lineLabour: {},
      paidHours: 10, headcount: 2, pendingShifts: 0, ignoredUnapproved: 0,
    }, FALLBACK_SETTINGS);
    expect(totalPacksMade(made)).toBe(Object.values(day.packsByLine).reduce((a, b) => a + b, 0));
    expect(totalPacksMade(made)).toBe(101 + 11); // 8-pack bags are not packs here; 10.5 rounds to 11
  });

  // Regression (2026-10-05): on 21 Sep 2026 the 157 fried chicken bags (made
  // in a separate facility) were counted as packs made, diluting the defect %.
  // Team efficiency keeps fried chicken (shared labour); the defect rate
  // filters it out before counting (services/defects-summary.ts).
  it("leaves fried chicken out of the defect rate's packs made", () => {
    const rows = [
      { category: "Calzones", fridgeQty: 540, eightPackBags: 0, batchesTarget: 108, batchesComplete: 108, portionsPerBatch: 10, packSize: 2, rrp: 10 },
      { category: FRIED_CHICKEN_CATEGORY, fridgeQty: 0, eightPackBags: 0, batchesTarget: 160, batchesComplete: 157, portionsPerBatch: 1, packSize: 1, rrp: 14.95 },
    ];
    expect(totalPacksMade(madeByLine(rows.filter(r => isMainKitchen(r.category))))).toBe(540);
  });
});
