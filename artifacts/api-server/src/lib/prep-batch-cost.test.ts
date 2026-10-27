import { describe, it, expect } from "vitest";
import {
  DEFAULT_PREP_LABOUR_RATE, batchProfit, grossPerBatch, parseLabourRate, prepLabourCost, recipePrepMinutes,
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

  it("prep labour = minutes ÷ 60 × £/hour", () => {
    expect(prepLabourCost(30, 14)).toBeCloseTo(7);
    expect(prepLabourCost(0, 14)).toBe(0);
  });

  it("profit after prep = gross − prep labour, with prep's share of gross", () => {
    const p = batchProfit(costing, 30, 14);
    expect(p.gross).toBeCloseTo(57.25);
    expect(p.prepLabour).toBeCloseTo(7);
    expect(p.profitAfterPrep).toBeCloseTo(50.25);
    expect(p.prepShareOfGross).toBeCloseTo(7 / 57.25);
  });

  it("has no share when the batch makes no gross", () => {
    expect(batchProfit({ ...costing, rrp: 0 }, 10, 14).prepShareOfGross).toBeNull();
  });
});

describe("parseLabourRate", () => {
  it("reads a stored rate and falls back to £14 for anything unusable", () => {
    expect(parseLabourRate("15.5")).toBe(15.5);
    expect(parseLabourRate(null)).toBe(DEFAULT_PREP_LABOUR_RATE);
    expect(parseLabourRate("abc")).toBe(DEFAULT_PREP_LABOUR_RATE);
    expect(parseLabourRate("0")).toBe(DEFAULT_PREP_LABOUR_RATE);
    expect(parseLabourRate("5000")).toBe(DEFAULT_PREP_LABOUR_RATE);
  });
});
