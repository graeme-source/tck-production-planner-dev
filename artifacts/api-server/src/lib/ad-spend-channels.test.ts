import { describe, it, expect } from "vitest";
import { combineChannelSpend, type ChannelRow, type MetaChannelRow } from "./ad-spend-channels";
import { roasPercentFor } from "./sales-trend";

const meta = (date: string, amount: number, source = "meta"): MetaChannelRow => ({ date, amount, source, syncedAt: null });
const google = (date: string, amount: number, source = "google_ads_script"): ChannelRow => ({ date, amount, source, receivedAt: null });

describe("combineChannelSpend", () => {
  it("with no Google data, every day is exactly what it was before", () => {
    const days = combineChannelSpend({ meta: [meta("2026-10-01", 50), meta("2026-10-02", 60, "manual")], google: [], googleFirstDate: null });
    expect(days.map(d => [d.date, d.amount, d.source, d.missing])).toEqual([
      ["2026-10-01", 50, "meta", null],
      ["2026-10-02", 60, "manual", null],
    ]);
  });

  it("adds Google to Meta (and to hand-typed) for the same day, in pence", () => {
    const days = combineChannelSpend({
      meta: [meta("2026-10-05", 100.1), meta("2026-10-06", 80, "manual")],
      google: [google("2026-10-05", 20.2), google("2026-10-06", 0)],
      googleFirstDate: "2026-10-05",
    });
    expect(days[0]).toMatchObject({ amount: 120.3, meta: 100.1, google: 20.2, missing: null });
    expect(days[1]).toMatchObject({ amount: 80, meta: 80, google: 0, source: "manual", missing: null });
  });

  it("days before Google's first day keep their Meta-only totals", () => {
    const days = combineChannelSpend({
      meta: [meta("2026-10-01", 50), meta("2026-10-05", 50)],
      google: [google("2026-10-05", 10)],
      googleFirstDate: "2026-10-05",
    });
    expect(days.map(d => d.amount)).toEqual([50, 60]);
  });

  it("from Google's first day, a day with no Google figure is missing (not £0)", () => {
    const days = combineChannelSpend({
      meta: [meta("2026-10-05", 50), meta("2026-10-06", 50)],
      google: [google("2026-10-05", 10)],
      googleFirstDate: "2026-10-05",
    });
    expect(days[1]).toMatchObject({ date: "2026-10-06", amount: null, meta: 50, google: null, missing: "google" });
  });

  it("a Google figure without a Meta one is still missing Meta", () => {
    const days = combineChannelSpend({ meta: [], google: [google("2026-10-07", 15)], googleFirstDate: "2026-10-01" });
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ amount: null, google: 15, meta: null, missing: "meta" });
  });

  it("days with nothing anywhere are absent, and output is oldest first", () => {
    const days = combineChannelSpend({
      meta: [meta("2026-10-09", 1), meta("2026-10-03", 1)],
      google: [google("2026-10-09", 1), google("2026-10-03", 1)],
      googleFirstDate: "2026-10-03",
    });
    expect(days.map(d => d.date)).toEqual(["2026-10-03", "2026-10-09"]);
  });
});

describe("ROAS divides by Meta + Google", () => {
  it("a week of £100 Meta + £50 Google against £450 of new-customer sales is 300%", () => {
    const dates = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"];
    const days = combineChannelSpend({
      meta: dates.map(d => meta(d, 100 / 7)),
      google: dates.map(d => google(d, 50 / 7)),
      googleFirstDate: dates[0]!,
    });
    const recorded = days.filter(d => d.amount != null);
    const spend = recorded.reduce((s, d) => s + d.amount!, 0);
    expect(Math.round(spend)).toBe(150);
    expect(roasPercentFor(450, recorded.length, dates.length, spend)).toBe(300);
    // Meta alone would have said 450%: Google's spend is what brings it down.
    expect(roasPercentFor(450, 7, 7, 100)).toBe(450);
  });

  it("one day without its Google figure means no ROAS for the week", () => {
    const dates = ["2026-10-04", "2026-10-05", "2026-10-06"];
    const days = combineChannelSpend({
      meta: dates.map(d => meta(d, 10)),
      google: [google("2026-10-04", 5), google("2026-10-06", 5)],
      googleFirstDate: "2026-10-04",
    });
    const recorded = days.filter(d => d.amount != null);
    expect(roasPercentFor(300, recorded.length, dates.length, 40)).toBeNull();
  });
});
