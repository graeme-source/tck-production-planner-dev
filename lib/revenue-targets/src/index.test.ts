import { describe, expect, it } from "vitest";
import {
  addMonths, applyChanges, DEFAULT_MINIMUM_TARGET, describeChanges, diffTargets, formatGbpShort,
  invertChanges, isFounderManagedSetting, isMonthKey, minimumFromSetting, monthLabel, monthsFrom, paceAgainstTargets,
  parseAmount, resolveStretch, stretchBelowMinimum, targetsForMonths, type TargetsState,
} from "./index";

describe("months", () => {
  it("adds months across year ends", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(monthsFrom("2026-10", 13)).toHaveLength(13);
    expect(monthsFrom("2026-10", 13)[12]).toBe("2027-10");
  });
  it("labels and validates", () => {
    expect(monthLabel("2026-11")).toBe("November 2026");
    expect(monthLabel("2026-10", { short: true })).toBe("October");
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-09")).toBe(true);
  });
});

describe("stretch carries forward", () => {
  const rows = [{ month: "2026-10", stretch: 150000 }, { month: "2026-12", stretch: 200000 }];
  it("uses the month's own figure", () => {
    expect(resolveStretch("2026-10", rows)).toEqual({ value: 150000, source: "set", fromMonth: "2026-10" });
  });
  it("carries the most recent earlier month's figure until changed", () => {
    expect(resolveStretch("2026-11", rows)).toEqual({ value: 150000, source: "carried", fromMonth: "2026-10" });
    expect(resolveStretch("2027-06", rows)).toEqual({ value: 200000, source: "carried", fromMonth: "2026-12" });
  });
  it("has no stretch before anything was ever set", () => {
    expect(resolveStretch("2026-09", rows)).toEqual({ value: null, source: "none", fromMonth: null });
    expect(targetsForMonths(["2026-09"], 120000, [])[0]!.stretch).toBeNull();
  });
  it("gives every month the same minimum", () => {
    const t = targetsForMonths(monthsFrom("2026-10", 3), 130000, rows);
    expect(t.map(x => x.minimum)).toEqual([130000, 130000, 130000]);
    expect(t.map(x => x.stretch)).toEqual([150000, 150000, 200000]);
  });
  it("falls back to the default minimum only when nothing valid is saved", () => {
    expect(minimumFromSetting(null)).toBe(DEFAULT_MINIMUM_TARGET);
    expect(minimumFromSetting("abc")).toBe(DEFAULT_MINIMUM_TARGET);
    expect(minimumFromSetting("0")).toBe(DEFAULT_MINIMUM_TARGET);
    expect(minimumFromSetting("135000")).toBe(135000);
  });
});

describe("the minimum's setting key", () => {
  it("is founder-managed, so the generic settings route can't change it", () => {
    expect(isFounderManagedSetting("monthly_revenue_target")).toBe(true);
    expect(isFounderManagedSetting("marketing_email_cadence_days")).toBe(false);
  });
});

describe("parseAmount", () => {
  it.each([
    ["150k", 150000], ["150K", 150000], ["150,000", 150000], ["£150,000", 150000],
    [" 175 000 ", 175000], ["1.5m", 1500000], ["12.5k", 12500], ["99.99", 99.99],
  ])("%s → %d", (input, out) => expect(parseAmount(input)).toBe(out));
  it.each(["", "  ", "abc", "-5", "0", "1.2.3", "5kk", "k"])("%s → null", input => expect(parseAmount(input)).toBeNull());
});

describe("changes", () => {
  const before: TargetsState = { minimum: 120000, rows: [{ month: "2026-10", stretch: 150000 }] };
  const after: TargetsState = { minimum: 130000, rows: [{ month: "2026-10", stretch: 150000 }, { month: "2026-11", stretch: 175000 }] };

  it("lists exactly what changes, in plain words", () => {
    const changes = diffTargets(before, after);
    expect(changes).toEqual([
      { kind: "minimum", month: null, from: 120000, to: 130000 },
      { kind: "stretch", month: "2026-11", from: null, to: 175000 },
    ]);
    expect(describeChanges(before, changes)).toEqual([
      "Minimum (every month): £120,000 → £130,000",
      "November 2026 stretch: £150,000 (same as October) → £175,000",
    ]);
  });

  it("describes clearing a month as going back to the carried figure, never zero", () => {
    const changes = diffTargets(after, { ...after, rows: [{ month: "2026-10", stretch: 150000 }] });
    expect(describeChanges(after, changes)).toEqual(["November 2026 stretch: £175,000 → £150,000 (same as October)"]);
  });

  it("finds nothing to change when nothing changed", () => {
    expect(diffTargets(before, { minimum: 120000, rows: [...before.rows] })).toEqual([]);
  });

  it("undo puts everything back", () => {
    const changes = diffTargets(before, after);
    const applied = applyChanges(before, changes);
    expect(applied).toEqual(after);
    expect(applyChanges(applied, invertChanges(changes))).toEqual(before);
  });

  it("flags a stretch that isn't above the minimum (including carried ones)", () => {
    const s: TargetsState = { minimum: 160000, rows: [{ month: "2026-10", stretch: 150000 }, { month: "2026-12", stretch: 200000 }] };
    expect(stretchBelowMinimum(s, monthsFrom("2026-10", 4))).toEqual(["2026-10", "2026-11"]);
  });
});

describe("pace against minimum and stretch", () => {
  const input = { monthToDate: 40000, projected: 124000, dayOfMonth: 10, daysInMonth: 31 };

  it("on pace for the minimum but short of stretch", () => {
    const p = paceAgainstTargets(input, 120000, 132000);
    expect(p.tone).toBe("minimum");
    expect(p.headline).toBe("On pace for the minimum, £8k short of stretch");
    expect(p.minimum.onPace).toBe(true);
    expect(p.stretch!.projectedGap).toBe(-8000);
    // Same sums as the old pace card: (target − so far) ÷ days left.
    expect(p.minimum.neededPerDay).toBeCloseTo((120000 - 40000) / 21);
  });

  it("on pace for stretch", () => {
    const p = paceAgainstTargets({ ...input, projected: 160000 }, 120000, 150000);
    expect(p.tone).toBe("stretch");
    expect(p.headline).toBe("On pace for stretch, £10k over");
  });

  it("behind the minimum", () => {
    const p = paceAgainstTargets({ ...input, projected: 100000 }, 120000, 150000);
    expect(p.tone).toBe("behind");
    expect(p.headline).toBe("£20k short of the minimum at this pace");
  });

  it("works with no stretch set", () => {
    const p = paceAgainstTargets(input, 120000, null);
    expect(p.stretch).toBeNull();
    expect(p.headline).toBe("On pace for the minimum, £4k over");
    expect(p.bar.stretchPct).toBeNull();
    expect(p.bar.minimumPct).toBe(100);
  });

  it("scales the bar so both markers fit", () => {
    const p = paceAgainstTargets(input, 120000, 150000);
    expect(p.bar.stretchPct).toBe(100);
    expect(p.bar.minimumPct).toBeCloseTo(80);
    expect(p.bar.fillPct).toBeCloseTo((40000 / 150000) * 100);
    expect(p.bar.minimumTodayPct).toBeCloseTo(((120000 * 10) / 31 / 150000) * 100);
  });

  it("short money", () => {
    expect(formatGbpShort(8000)).toBe("£8k");
    expect(formatGbpShort(1250000)).toBe("£1.3m");
    expect(formatGbpShort(950)).toBe("£950");
  });
});
