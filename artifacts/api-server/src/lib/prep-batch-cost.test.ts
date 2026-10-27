import { describe, it, expect } from "vitest";
import {
  DEFAULT_LABOUR_SETTINGS, batchProfit, grossPerBatch, labourCost, lineMinutesPerBatch, parseLabourSettings, recipePrepMinutes,
} from "./prep-batch-cost";
import type { ItemTiming, Confidence } from "./prep-timing";
import type { PrepUsage } from "./prep-usage";

function timing(itemKey: string, over: { perKg?: number | null; perCount?: number | null; countUnit?: string | null; confidence?: Confidence }): ItemTiming {
  return {
    itemKey,
    sessions: 10,
    minutes: { median: 5, q1: 4, q3: 6 },
    rate: {
      minutesPerKg: over.perKg ?? null,
      minutesPerCount: over.perCount ?? null,
      countUnit: over.countUnit ?? null,
      rateSessions: 10, trimmed: 0, rateSpread: null,
    },
    confidence: over.confidence ?? "confident",
    days: 5, people: 2, lastAt: 0,
  };
}
const use = (itemKey: string, grams: number | null, count: number | null = null, countUnit: string | null = null): PrepUsage =>
  ({ itemKey, kind: "ingredient", id: Number(itemKey.split(":")[1]), grams, count, countUnit });

describe("recipePrepMinutes", () => {
  it("multiplies each item's amount per batch by its measured rate", () => {
    const timings = new Map([
      ["ingredient:1", timing("ingredient:1", { perKg: 3 })],
      ["ingredient:2", timing("ingredient:2", { perCount: 0.25, countUnit: "pieces" })],
    ]);
    const r = recipePrepMinutes([use("ingredient:1", 2000), use("ingredient:2", null, 20, "pieces")], timings);
    expect(r.minutes).toBeCloseTo(6 + 5);
    expect(r.timedItems).toBe(2);
  });

  it("lists items with no timings yet and adds nothing for them", () => {
    const r = recipePrepMinutes([use("ingredient:1", 2000), use("ingredient:9", 500)], new Map([["ingredient:1", timing("ingredient:1", { perKg: 3 })]]));
    expect(r.minutes).toBeCloseTo(6);
    expect(r.lines.find(l => l.itemKey === "ingredient:9")).toEqual({ itemKey: "ingredient:9", minutes: null, status: "not_measured", confidence: null });
    expect(r.timedItems).toBe(1);
    expect(r.totalItems).toBe(2);
  });

  it("won't mix measures — a weighed amount and a per-piece rate don't price each other", () => {
    const r = recipePrepMinutes([use("ingredient:2", 300)], new Map([["ingredient:2", timing("ingredient:2", { perCount: 0.25, countUnit: "pieces" })]]));
    expect(r.lines[0]!.status).toBe("no_matching_amount");
    expect(r.minutes).toBe(0);
  });

  it("is as confident as its weakest item that matters (10% or more of the minutes)", () => {
    const timings = new Map([
      ["ingredient:1", timing("ingredient:1", { perKg: 10, confidence: "confident" })],
      ["ingredient:2", timing("ingredient:2", { perKg: 1, confidence: "needs_more_data" })],
      ["ingredient:3", timing("ingredient:3", { perKg: 5, confidence: "settling" })],
    ]);
    // 20 + 0.5 + 5 minutes: the 0.5 is under 10% and doesn't drag it down.
    const r = recipePrepMinutes([use("ingredient:1", 2000), use("ingredient:2", 500), use("ingredient:3", 1000)], timings);
    expect(r.confidence).toBe("settling");
  });

  it("has no confidence when nothing is timed", () => {
    expect(recipePrepMinutes([use("ingredient:1", 100)], new Map()).confidence).toBeNull();
  });
});

describe("£ per batch", () => {
  const costing = { rrp: 13.95, packIngredientCost: 2.1, packagingCost: 0.4, packsPerBatch: 5 };

  it("gross = (list price − cost per pack incl. packaging) × packs per batch", () => {
    expect(grossPerBatch(costing)).toBeCloseTo(57.25);
  });

  it("labour = minutes × people × £/hour ÷ 60", () => {
    expect(labourCost(30, 1, 17.05)).toBeCloseTo(8.525);
    expect(labourCost(1.5, 4, 17.05)).toBeCloseTo(1.705);
    expect(labourCost(0, 4, 17.05)).toBe(0);
  });

  it("line minutes per batch: one builder's build time shared by the builders working at once", () => {
    // 3 minutes a batch for one builder, two building side by side → a batch every 1.5 min.
    expect(lineMinutesPerBatch(180, 2)).toBeCloseTo(1.5);
    expect(lineMinutesPerBatch(null, 2)).toBeNull();
    expect(lineMinutesPerBatch(0, 2)).toBeNull();
    expect(lineMinutesPerBatch(180, 0)).toBeNull();
  });

  it("weights prep by its one person and the line by its four", () => {
    const s = DEFAULT_LABOUR_SETTINGS; // £17.05, prep 1, line 4, 2 builders
    const p = batchProfit(costing, { prep: 30, line: lineMinutesPerBatch(180, s.lineBuilders) }, s);
    expect(p.gross).toBeCloseTo(57.25);
    expect(p.prepLabour).toBeCloseTo(30 * 1 * 17.05 / 60);  // £8.53
    expect(p.lineLabour).toBeCloseTo(1.5 * 4 * 17.05 / 60); // £1.71
    expect(p.profitAfterLabour).toBeCloseTo(57.25 - 8.525 - 1.705);
    expect(p.profitPerLineMinute).toBeCloseTo((57.25 - 8.525 - 1.705) / 1.5);
    expect(p.labourShareOfGross).toBeCloseTo((8.525 + 1.705) / 57.25);
  });

  it("uses the crew sizes and rate it is given — they are settings, not constants", () => {
    const p = batchProfit(costing, { prep: 30, line: 2 }, { ratePerHour: 12, prepCrew: 2, lineCrew: 5, lineBuilders: 2 });
    expect(p.prepLabour).toBeCloseTo(30 * 2 * 12 / 60);
    expect(p.lineLabour).toBeCloseTo(2 * 5 * 12 / 60);
  });

  it("without a line time: no line labour, no profit per line-minute", () => {
    const p = batchProfit(costing, { prep: 30, line: null }, DEFAULT_LABOUR_SETTINGS);
    expect(p.lineLabour).toBeNull();
    expect(p.profitPerLineMinute).toBeNull();
    expect(p.profitAfterLabour).toBeCloseTo(57.25 - 8.525);
  });

  it("has no labour share when the batch makes no gross", () => {
    expect(batchProfit({ ...costing, rrp: 0 }, { prep: 10, line: 1 }, DEFAULT_LABOUR_SETTINGS).labourShareOfGross).toBeNull();
  });
});

describe("parseLabourSettings", () => {
  it("defaults to £17.05 an hour, prep 1 person, line 4 people, 2 builders", () => {
    expect(parseLabourSettings({})).toEqual({
      settings: { ratePerHour: 17.05, prepCrew: 1, lineCrew: 4, lineBuilders: 2 },
      defaulted: ["ratePerHour", "prepCrew", "lineCrew", "lineBuilders"],
    });
  });
  it("reads stored values and falls back per setting for anything unusable", () => {
    const r = parseLabourSettings({ ratePerHour: "18.5", prepCrew: "abc", lineCrew: "5", lineBuilders: "0" });
    expect(r.settings).toEqual({ ratePerHour: 18.5, prepCrew: 1, lineCrew: 5, lineBuilders: 2 });
    expect(r.defaulted).toEqual(["prepCrew", "lineBuilders"]);
    expect(parseLabourSettings({ ratePerHour: "5000" }).settings.ratePerHour).toBe(17.05);
  });
});
