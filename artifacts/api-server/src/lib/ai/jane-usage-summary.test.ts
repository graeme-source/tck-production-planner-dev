import { describe, expect, it } from "vitest";
import type { UsageEvent } from "../stock-ledger";
import { lastFullWeeks, summariseUsage } from "./jane-usage-summary";

const at = (iso: string, qty: number, source: UsageEvent["source"] = "prep"): UsageEvent => ({ at: Date.parse(iso), qty, source, planId: 1 });
const chorizo = { name: "Diced Chorizo", unit: "g", packWeight: 500 };

describe("lastFullWeeks", () => {
  it("leaves out the unfinished week", () => {
    expect(lastFullWeeks("2026-11-05", 5)).toEqual({ from: "2026-09-28", to: "2026-11-01" });
  });

  it("counts Monday as the start of a new week", () => {
    expect(lastFullWeeks("2026-11-02", 1)).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(lastFullWeeks("2026-11-01", 1)).toEqual({ from: "2026-10-19", to: "2026-10-25" });
  });
});

describe("summariseUsage", () => {
  const period = { from: "2026-09-28", to: "2026-11-01" };

  it("answers the chorizo question: total, weekly average and packs", () => {
    const s = summariseUsage({
      ingredient: chorizo,
      coverage: "tracked",
      usage: [at("2026-09-29T09:00:00Z", 2000), at("2026-10-06T09:00:00Z", 3000, "build"), at("2026-10-07T09:00:00Z", 500, "waste")],
      period,
    });
    expect(s.totalUsed).toBe(5500);
    expect(s.averagePerWeek).toBe(1100);
    expect(s.averagePacksPerWeek).toBe(2.2);
    expect(s.daysUsed).toBe(3);
    expect(s.wentOn).toEqual([
      { on: "Prep tins ticked", used: 2000 },
      { on: "Added at building", used: 3000 },
      { on: "Recorded waste", used: 500 },
    ]);
  });

  it("counts a week with none in the average, and lists it", () => {
    const s = summariseUsage({ ingredient: chorizo, coverage: "tracked", usage: [at("2026-09-29T09:00:00Z", 5000)], period });
    expect(s.weeks).toBe(5);
    expect(s.averagePerWeek).toBe(1000);
    expect(s.byWeek).toHaveLength(5);
    expect(s.byWeek.map((w) => w.used)).toEqual([5000, 0, 0, 0, 0]);
  });

  it("uses the London day: 23:30 UTC on a BST Sunday is already Monday", () => {
    const s = summariseUsage({ ingredient: chorizo, coverage: "tracked", usage: [at("2026-10-04T23:30:00Z", 100)], period });
    expect(s.byWeek.find((w) => w.weekStarting === "2026-10-05")?.used).toBe(100);
  });

  it("ignores anything outside the period", () => {
    const s = summariseUsage({ ingredient: chorizo, coverage: "tracked", usage: [at("2026-09-27T09:00:00Z", 999), at("2026-11-02T09:00:00Z", 999)], period });
    expect(s.totalUsed).toBe(0);
  });

  it("says when usage is only an estimate or can't be tracked", () => {
    expect(summariseUsage({ ingredient: chorizo, coverage: "estimated", usage: [], period }).howTracked).toMatch(/estimated/i);
    expect(summariseUsage({ ingredient: { ...chorizo, packWeight: null }, coverage: "untracked", usage: [], period })).toMatchObject({ averagePacksPerWeek: null, coverage: "untracked" });
  });
});
