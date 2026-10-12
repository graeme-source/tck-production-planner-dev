import { describe, expect, it } from "vitest";
import {
  adWindows, earliestDayNeeded, measureWindow, monthToDateSeries, recommend, roasBand, roasShade, roasVerdict, shadeAtRatio, ROAS_SHADE_STEPS, rollingSeries,
  spendSourceLine, windowOf, zeroSpendDays, type AdDay, type AdEfficiencySettings,
} from "./ad-efficiency";
import { addDays } from "./roas";

// Graeme's sheet ("The Calzone Kitchen Numbers"), 4–10 Oct 2026:
// column L (total ads cost) and F (1st-customer sales). 1st Customer RA on
// 10 Oct = SUM(F7:F13)/SUM(L7:L13) = 240%.
const SHEET: Array<[string, number, number]> = [
  // date, ads cost (L), 1st-customer sales (F)
  ["2026-10-10", 545.55, 1531.44],
  ["2026-10-09", 580.53, 1154.83],
  ["2026-10-08", 578.19, 1490.48],
  ["2026-10-07", 646.15, 1811.64],
  ["2026-10-06", 523.59, 1372.42],
  ["2026-10-05", 469.94, 761.12],
  ["2026-10-04", 547.16, 1200.35],
];

const SETTINGS: AdEfficiencySettings = {
  ncRoas7dTargetPct: 210,
  ncRoasMtdTargetPct: 210,
  totalRoas30dTargetPct: 700,
  amberWidthPct: 10,
  holdBandPct: 10,
  raiseSpendMinPct: 10,
  raiseSpendMaxPct: 20,
  smallSampleSpend: 350,
};

/** 60 days of steady filler ending 10 Oct, with the sheet's week on top. */
function sheetDays(overrides: Partial<Record<string, Partial<AdDay>>> = {}): AdDay[] {
  const out: AdDay[] = [];
  for (let i = 59; i >= 0; i--) {
    const date = addDays("2026-10-10", -i);
    const sheet = SHEET.find(([d]) => d === date);
    const base: AdDay = sheet
      ? { date, spend: sheet[1], newCustomerRevenue: sheet[2], revenue: 3777 }
      : { date, spend: 500, newCustomerRevenue: 1000, revenue: 4000 };
    out.push({ ...base, ...overrides[date] });
  }
  return out;
}

describe("windows", () => {
  it("are complete London days ending at the last complete day", () => {
    const w = adWindows("2026-10-10");
    expect([w.last7.from, w.last7.to, w.last7.dayCount]).toEqual(["2026-10-04", "2026-10-10", 7]);
    expect([w.monthToDate.from, w.monthToDate.to, w.monthToDate.dayCount]).toEqual(["2026-10-01", "2026-10-10", 10]);
    expect([w.last30.from, w.last30.to, w.last30.dayCount]).toEqual(["2026-09-11", "2026-10-10", 30]);
  });

  it("this month is empty on the 1st rather than showing last month", () => {
    const w = adWindows("2026-10-31"); // today = 1 Nov
    expect(w.monthToDate.from).toBe("2026-11-01");
    expect(w.monthToDate.dayCount).toBe(0);
  });

  it("asks for enough history to draw 30 points of a rolling 30-day figure", () => {
    expect(earliestDayNeeded("2026-10-10")).toBe(addDays("2026-10-10", -58));
  });
});

describe("rolling 7-day new-customer ROAS", () => {
  it("matches the sheet's 1st Customer RA: SUM(F)/SUM(L) over 4–10 Oct = 240%", () => {
    const r = measureWindow(sheetDays(), adWindows("2026-10-10").last7, "newCustomer");
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.spend).toBeCloseTo(3891.11, 2);
    expect(r.revenue).toBeCloseTo(9322.28, 2);
    expect(r.percent).toBe(240);
  });

  it("one day matches the sheet's daily figures (10 Oct: ROAS 692%, NCROAS 281%)", () => {
    const day = windowOf("2026-10-10", "2026-10-10");
    const nc = measureWindow(sheetDays(), day, "newCustomer");
    const total = measureWindow(sheetDays(), day, "total");
    expect(nc.available && nc.percent).toBe(281);
    expect(total.available && total.percent).toBe(692);
  });

  it("is sums ÷ sums, not the average of the daily percentages", () => {
    const daily = SHEET.map(([, l, f]) => f / l);
    const meanOfDaily = Math.round((daily.reduce((a, b) => a + b, 0) / daily.length) * 100);
    expect(meanOfDaily).not.toBe(240);
  });

  it("shows no number when any day's spend is missing — and says how many", () => {
    const r = measureWindow(sheetDays({ "2026-10-06": { spend: null } }), adWindows("2026-10-10").last7, "newCustomer");
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toBe("Waiting on 1 day of spend");
  });

  it("is unknown (not 0%) when a day of orders wasn't sent", () => {
    const days = sheetDays().filter((d) => d.date !== "2026-10-08");
    const r = measureWindow(days, adWindows("2026-10-10").last7, "newCustomer");
    expect(r.available).toBe(false);
  });

  it("the sparkline ends on today's card figure, one point per day", () => {
    const s = rollingSeries(sheetDays(), "newCustomer", 7, "2026-10-10");
    expect(s).toHaveLength(30);
    expect(s[29]).toEqual({ date: "2026-10-10", percent: 240 });
    expect(s[0]!.date).toBe("2026-09-11");
  });
});

describe("month to date", () => {
  it("sums the 1st to yesterday", () => {
    const days = sheetDays();
    const r = measureWindow(days, adWindows("2026-10-10").monthToDate, "newCustomer");
    // 1–3 Oct filler: 3 × £1,000 ÷ 3 × £500; plus the sheet week.
    const expected = Math.round(((3000 + 9322.28) / (1500 + 3891.11)) * 100);
    expect(r.available && r.percent).toBe(expected);
  });

  it("its sparkline is the running figure, ending on the card's", () => {
    const s = monthToDateSeries(sheetDays(), "newCustomer", "2026-10-10");
    expect(s).toHaveLength(10);
    expect(s[0]).toEqual({ date: "2026-10-01", percent: 200 });
    const card = measureWindow(sheetDays(), adWindows("2026-10-10").monthToDate, "newCustomer");
    expect(s[9]!.percent).toBe(card.available ? card.percent : -1);
  });

  it("on the 1st there are no complete days yet", () => {
    const r = measureWindow(sheetDays(), adWindows("2026-10-31").monthToDate, "newCustomer");
    expect(r).toEqual({ available: false, reason: "No complete days in this period yet" });
  });
});

describe("30-day ROAS on total sales", () => {
  it("is total sales ÷ ad spend over the 30 days ending yesterday", () => {
    const r = measureWindow(sheetDays(), adWindows("2026-10-10").last30, "total");
    const expected = Math.round(((23 * 4000 + 7 * 3777) / (23 * 500 + 3891.11)) * 100);
    expect(r.available && r.percent).toBe(expected);
  });
});

describe("traffic lights", () => {
  it("green at or above target, amber within 10% under, red below", () => {
    expect(roasBand(210, 210, 10)).toBe("green");
    expect(roasBand(300, 210, 10)).toBe("green");
    expect(roasBand(209, 210, 10)).toBe("amber");
    expect(roasBand(189, 210, 10)).toBe("amber"); // 90% of 210 = 189
    expect(roasBand(188, 210, 10)).toBe("red");
    expect(roasBand(630, 700, 10)).toBe("amber");
    expect(roasBand(629, 700, 10)).toBe("red");
  });

  it("follows the amber width setting", () => {
    expect(roasBand(180, 210, 20)).toBe("amber");
    expect(roasBand(200, 210, 0)).toBe("red");
  });

  it("is neutral with no figure or no target", () => {
    expect(roasBand(null, 210, 10)).toBe("neutral");
    expect(roasBand(250, 0, 10)).toBe("neutral");
  });
});

describe("what to do", () => {
  const w = adWindows("2026-10-10");
  /** Scale the sheet week's new-customer sales so the 7-day lands on `target`%. */
  const at = (percent: number, extra: Partial<Record<string, Partial<AdDay>>> = {}): AdDay[] => {
    const factor = percent / 239.58;
    const o: Partial<Record<string, Partial<AdDay>>> = { ...extra };
    for (const [d, , f] of SHEET) o[d] = { newCustomerRevenue: f * factor, ...extra[d] };
    return sheetDays(o);
  };

  it("the sheet's week (240% vs 210%) says raise spend 10–20%", () => {
    const r = recommend({ days: sheetDays(), windows: w, settings: SETTINGS });
    expect(r.tone).toBe("raise");
    expect(r.headline).toBe(
      "You're beating your new-customer target — you're probably not spending enough. Consider raising ad spend ~10–20% and watch the 7-day number.",
    );
    expect(r.softened).toBe(false);
  });

  it("within ±10% of target says hold", () => {
    for (const p of [190, 210, 230]) {
      const r = recommend({ days: at(p), windows: w, settings: SETTINGS });
      expect(r.tone).toBe("hold");
      expect(r.headline).toBe("On target — hold spend steady.");
    }
  });

  it("below 90% of target says trim", () => {
    const r = recommend({ days: at(180), windows: w, settings: SETTINGS });
    expect(r.tone).toBe("trim");
    expect(r.headline).toBe(
      "Below target — you're probably spending too much for the new customers you're getting. Trim spend or pause the weakest ads.",
    );
  });

  it("raising with overall 30-day ROAS under 700% adds the returning-customer check", () => {
    // The filler days (£4,000 on £500) give 800%; drop total sales to bring the 30 days under 700%.
    const lowTotal: Partial<Record<string, Partial<AdDay>>> = {};
    for (let i = 0; i < 30; i++) lowTotal[addDays("2026-10-10", -i)] = { revenue: 3000 };
    const r = recommend({ days: at(260, lowTotal), windows: w, settings: SETTINGS });
    expect(r.tone).toBe("raise");
    expect(r.notes[0]).toMatch(/^…but overall ROAS is \d+% over the last 30 days, below your 700% target — check returning-customer sales before scaling\.$/);
  });

  it("no returning-customer note when overall ROAS is on target", () => {
    const r = recommend({ days: at(260), windows: w, settings: SETTINGS });
    expect(r.notes.some((n) => n.includes("returning-customer"))).toBe(false);
  });

  it("a missing spend day: no advice, and says the number is incomplete", () => {
    const r = recommend({ days: sheetDays({ "2026-10-09": { spend: null } }), windows: w, settings: SETTINGS });
    expect(r.tone).toBe("unknown");
    expect(r.headline).toBe("No advice yet — the 7-day number is incomplete: waiting on 1 day of spend.");
  });

  it("a £0 spend day is flagged as possibly incomplete", () => {
    const days = sheetDays({ "2026-10-06": { spend: 0 } });
    expect(zeroSpendDays(days, w.last7)).toEqual(["2026-10-06"]);
    const r = recommend({ days, windows: w, settings: SETTINGS });
    expect(r.notes.some((n) => n.startsWith("1 day in the last 7 show £0 ad spend (6 Oct)"))).toBe(true);
  });

  it("very low spend softens the advice", () => {
    const tiny: Partial<Record<string, Partial<AdDay>>> = {};
    for (const [d] of SHEET) tiny[d] = { spend: 40, newCustomerRevenue: 120 }; // 300%, £280 spend
    const r = recommend({ days: sheetDays(tiny), windows: w, settings: SETTINGS });
    expect(r.tone).toBe("raise");
    expect(r.softened).toBe(true);
    expect(r.headline).toMatch(/^Early sign you're beating your new-customer target/);
    expect(r.notes.at(-1)).toBe(
      "Only £280 spent on ads in the last 7 days (under £350) — too little to judge reliably, so treat this as a hint, not a verdict.",
    );
  });

  it("thresholds follow the settings", () => {
    const wide = { ...SETTINGS, holdBandPct: 20, raiseSpendMinPct: 5, raiseSpendMaxPct: 15 };
    expect(recommend({ days: sheetDays(), windows: w, settings: wide }).tone).toBe("hold"); // 240 < 252
    expect(recommend({ days: at(270), windows: w, settings: wide }).headline).toContain("~5–15%");
  });
});

describe("spendSourceLine — which ad spend the cards count", () => {
  it("before Google Ads has sent anything, says it isn't included", () => {
    const line = spendSourceLine([
      { date: "2026-10-09", source: "meta" },
      { date: "2026-10-10", source: "manual" },
    ], null);
    expect(line).toBe("Ad spend counted: Meta ads (synced) · 1 Meta day typed by hand (10 Oct). Google Ads isn't connected, so its spend is not included.");
  });

  it("once Google has data, the 'isn't connected' note disappears and Google is named with its first day", () => {
    const line = spendSourceLine([{ date: "2026-10-09", source: "meta" }], "2026-09-11");
    expect(line).not.toMatch(/isn't connected/);
    expect(line).toBe("Ad spend counted: Meta ads (synced) · Google Ads, from 11 Sep.");
  });

  it("flags days the Google script hasn't sent", () => {
    const line = spendSourceLine([
      { date: "2026-10-09", source: "manual", missing: null },
      { date: "2026-10-10", source: "manual", missing: "google" },
    ], "2026-10-01");
    expect(line).toMatch(/No Google Ads figure for 10 Oct yet/);
  });

  it("keeps a long list of typed days short", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ date: `2026-10-0${i + 1}`, source: "manual" }));
    expect(spendSourceLine(rows, null)).toMatch(/8 Meta days typed by hand \(1 Oct, 2 Oct, 3 Oct, 4 Oct, 5 Oct and 3 more\)/);
  });
});

describe("ROAS shade scale", () => {
  it("runs from dark red to deep platinum in 31 shades", () => {
    expect(shadeAtRatio(0.5)).toMatchObject({ step: 0, hex: "#7f1d1d", darkBackground: true });
    expect(shadeAtRatio(2)).toMatchObject({ step: ROAS_SHADE_STEPS, hex: "#0f5f59", darkBackground: true });
    const hexes = new Set(Array.from({ length: 81 }, (_, i) => shadeAtRatio(0.7 + i * 0.01).hex));
    expect(hexes.size).toBe(ROAS_SHADE_STEPS + 1);
  });
  it("tells a bit above from well above target", () => {
    const onTarget = roasShade(210, 210)!;
    const bitAbove = roasShade(230, 210)!;
    const wellAbove = roasShade(290, 210)!;
    expect(onTarget.step).toBeLessThan(bitAbove.step);
    expect(bitAbove.step).toBeLessThan(wellAbove.step);
    expect(onTarget.hex).not.toBe(wellAbove.hex);
  });
  it("gets darker below target too", () => {
    expect(roasShade(160, 210)!.step).toBeLessThan(roasShade(195, 210)!.step);
  });
  it("uses dark text on the yellow shades", () => {
    expect(shadeAtRatio(0.95).darkBackground).toBe(false);
  });
  it("is null with no figure or target", () => {
    expect(roasShade(null, 210)).toBeNull();
    expect(roasShade(200, 0)).toBeNull();
  });
  it("says well above from 25% over target", () => {
    expect(roasVerdict(271, 210, 10)).toBe("Well above target");
    expect(roasVerdict(215, 210, 10)).toBe("On or above target");
    expect(roasVerdict(195, 210, 10)).toBe("Just under target");
  });
});
