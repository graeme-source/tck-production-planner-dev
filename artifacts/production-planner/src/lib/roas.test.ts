import { describe, it, expect } from "vitest";
import {
  addDays,
  addMonths,
  customWindow,
  dayRoas,
  daysBetween,
  DEFAULT_PERIOD,
  endOfMonth,
  londonDayString,
  PERIOD_PRESETS,
  periodWindow,
  rollingWindow,
  startOfMonth,
  windowRoas,
  yesterdayLondon,
  type PeriodPresetId,
  type RoasWindow,
} from "./roas";

/** A London-clock instant, written the way a human reads it. */
function at(iso: string): Date {
  return new Date(iso);
}

describe("londonDayString", () => {
  it("uses the London day, not UTC, through a BST evening", () => {
    // 23:30 UTC on 14 June is already 00:30 on the 15th in London.
    expect(londonDayString(at("2026-06-14T23:30:00Z"))).toBe("2026-06-15");
  });

  it("uses the London day in winter, when London is UTC", () => {
    expect(londonDayString(at("2026-01-14T23:30:00Z"))).toBe("2026-01-14");
  });
});

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  });

  it("goes backwards across a year boundary", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("does not drift across the spring clock change", () => {
    // BST starts 29 March 2026. A naive local-time addition loses an hour here.
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
  });

  it("does not drift across the autumn clock change", () => {
    // BST ends 25 October 2026.
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
  });

  it("rejects a value that is not a date", () => {
    expect(() => addDays("not-a-date", 1)).toThrow();
  });
});

describe("daysBetween", () => {
  it("is inclusive of both ends", () => {
    expect(daysBetween("2026-09-15", "2026-09-17")).toEqual(["2026-09-15", "2026-09-16", "2026-09-17"]);
  });

  it("returns a single day when from equals to", () => {
    expect(daysBetween("2026-09-15", "2026-09-15")).toEqual(["2026-09-15"]);
  });

  it("returns nothing when from is after to", () => {
    expect(daysBetween("2026-09-17", "2026-09-15")).toEqual([]);
  });
});

describe("rollingWindow — seven full days ending yesterday", () => {
  it("ends yesterday and never includes today", () => {
    const win = rollingWindow(at("2026-09-18T10:00:00Z"));
    expect(win.to).toBe("2026-09-17");
    expect(win.from).toBe("2026-09-11");
    expect(win.days).toHaveLength(7);
    expect(win.days).not.toContain("2026-09-18");
  });

  it("still excludes today one minute after London midnight", () => {
    // 00:01 BST on the 18th = 23:01 UTC on the 17th.
    const win = rollingWindow(at("2026-09-17T23:01:00Z"));
    expect(win.to).toBe("2026-09-17");
    expect(win.days).not.toContain("2026-09-18");
  });

  it("still excludes today one minute before London midnight", () => {
    // 23:59 BST on the 18th = 22:59 UTC on the 18th.
    const win = rollingWindow(at("2026-09-18T22:59:00Z"));
    expect(win.to).toBe("2026-09-17");
    expect(win.from).toBe("2026-09-11");
  });

  it("rolls the window forward by exactly one day at London midnight", () => {
    const before = rollingWindow(at("2026-06-14T22:59:00Z")); // 23:59 BST 14 June
    const after = rollingWindow(at("2026-06-14T23:01:00Z")); // 00:01 BST 15 June
    expect(before.to).toBe("2026-06-13");
    expect(after.to).toBe("2026-06-14");
  });

  it("spans a month boundary correctly", () => {
    const win = rollingWindow(at("2026-09-03T12:00:00Z"));
    expect(win.from).toBe("2026-08-27");
    expect(win.to).toBe("2026-09-02");
    expect(win.days).toHaveLength(7);
  });

  it("spans the autumn clock change without losing or repeating a day", () => {
    const win = rollingWindow(at("2026-10-28T12:00:00Z"));
    expect(win.from).toBe("2026-10-21");
    expect(win.to).toBe("2026-10-27");
    expect(new Set(win.days).size).toBe(7);
  });

  it("honours a different day count", () => {
    const win = rollingWindow(at("2026-09-18T12:00:00Z"), 3);
    expect(win.days).toEqual(["2026-09-15", "2026-09-16", "2026-09-17"]);
  });

  it("refuses a nonsense day count", () => {
    expect(() => rollingWindow(at("2026-09-18T12:00:00Z"), 0)).toThrow();
    expect(() => rollingWindow(at("2026-09-18T12:00:00Z"), 1.5)).toThrow();
  });
});

describe("yesterdayLondon", () => {
  it("is the day before the London today", () => {
    expect(yesterdayLondon(at("2026-09-18T10:00:00Z"))).toBe("2026-09-17");
  });

  it("agrees with the end of the rolling window", () => {
    const now = at("2026-06-14T23:30:00Z");
    expect(yesterdayLondon(now)).toBe(rollingWindow(now).to);
  });
});

describe("dayRoas", () => {
  it("divides revenue by spend and renders a whole percentage", () => {
    const r = dayRoas(2000, 600);
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.percent).toBe(333);
    expect(r.ratio).toBeCloseTo(3.3333, 4);
  });

  it("is unavailable — never 0% — when no spend has been recorded", () => {
    const r = dayRoas(2000, null);
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toMatch(/no ad spend recorded/i);
  });

  it("treats undefined spend the same as missing", () => {
    expect(dayRoas(2000, undefined).available).toBe(false);
  });

  it("is unavailable — never Infinity — when the recorded spend is zero", () => {
    const r = dayRoas(2000, 0);
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toMatch(/nothing to divide by/i);
  });

  it("guards a negative spend the same way", () => {
    expect(dayRoas(2000, -5).available).toBe(false);
  });

  it("is unavailable when the day's revenue is not known yet", () => {
    expect(dayRoas(null, 600).available).toBe(false);
  });

  it("reports a genuine zero-revenue day as 0%, because that is known", () => {
    const r = dayRoas(0, 600);
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.percent).toBe(0);
  });

  it("never returns a non-finite figure", () => {
    for (const spend of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      const r = dayRoas(1000, spend as number | null | undefined);
      if (r.available) expect(Number.isFinite(r.ratio)).toBe(true);
    }
  });
});

describe("windowRoas", () => {
  const win: RoasWindow = rollingWindow(at("2026-09-18T12:00:00Z")); // 11th–17th Sep

  function spendForAll(amount: number) {
    return win.days.map((date) => ({ date, amount }));
  }

  it("divides total revenue by total spend when all seven days have spend", () => {
    const r = windowRoas({ window: win, revenue: 7000, spendDays: spendForAll(100) });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.spend).toBe(700);
    expect(r.percent).toBe(1000);
  });

  it("refuses to average over a shorter window, and says how many days are missing", () => {
    const spendDays = spendForAll(100).slice(0, 5);
    const r = windowRoas({ window: win, revenue: 7000, spendDays });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toBe("Waiting on 2 days of spend");
  });

  it("uses the singular for one missing day", () => {
    const spendDays = spendForAll(100).slice(0, 6);
    const r = windowRoas({ window: win, revenue: 7000, spendDays });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toBe("Waiting on 1 day of spend");
  });

  it("counts a null amount as missing, not as zero", () => {
    const spendDays = spendForAll(100).map((d, i) => (i === 3 ? { ...d, amount: null } : d));
    const r = windowRoas({ window: win, revenue: 7000, spendDays });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toBe("Waiting on 1 day of spend");
  });

  it("ignores spend rows from outside the window", () => {
    const spendDays = [...spendForAll(100), { date: "2026-09-18", amount: 999 }, { date: "2026-01-01", amount: 999 }];
    const r = windowRoas({ window: win, revenue: 7000, spendDays });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.spend).toBe(700);
  });

  it("does not double-count a duplicated day", () => {
    const spendDays = [...spendForAll(100), { date: win.days[0], amount: 100 }];
    const r = windowRoas({ window: win, revenue: 7000, spendDays });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.spend).toBe(700);
  });

  it("is unavailable — never Infinity — when every day is a recorded zero", () => {
    const r = windowRoas({ window: win, revenue: 7000, spendDays: spendForAll(0) });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toMatch(/nothing to divide by/i);
  });

  it("is unavailable when there are no spend rows at all", () => {
    const r = windowRoas({ window: win, revenue: 7000, spendDays: [] });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toBe("Waiting on 7 days of spend");
  });

  it("is unavailable when the window's revenue is not loaded yet", () => {
    const r = windowRoas({ window: win, revenue: null, spendDays: spendForAll(100) });
    expect(r.available).toBe(false);
  });

  it("reports a genuine zero-revenue window as 0%", () => {
    const r = windowRoas({ window: win, revenue: 0, spendDays: spendForAll(100) });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.percent).toBe(0);
  });

  it("matches the single-day definition when the window is one day", () => {
    const oneDay = rollingWindow(at("2026-09-18T12:00:00Z"), 1);
    const viaWindow = windowRoas({ window: oneDay, revenue: 2000, spendDays: [{ date: "2026-09-17", amount: 600 }] });
    const viaDay = dayRoas(2000, 600);
    expect(viaWindow.available && viaDay.available).toBe(true);
    if (!viaWindow.available || !viaDay.available) return;
    expect(viaWindow.percent).toBe(viaDay.percent);
  });
});

// ── The selectable periods ─────────────────────────────────────────────────

describe("month arithmetic", () => {
  it("finds the start and end of a month", () => {
    expect(startOfMonth("2026-09-18")).toBe("2026-09-01");
    expect(endOfMonth("2026-09-18")).toBe("2026-09-30");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfMonth("2024-02-10")).toBe("2024-02-29"); // leap year
  });

  it("clamps to the last day when the target month is shorter", () => {
    expect(addMonths("2026-08-31", -6)).toBe("2026-02-28");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });

  it("goes back a whole year", () => {
    expect(addMonths("2026-09-17", -12)).toBe("2025-09-17");
  });

  it("crosses a year boundary going back six months", () => {
    expect(addMonths("2026-02-15", -6)).toBe("2025-08-15");
  });
});

describe("PERIOD_PRESETS", () => {
  it("reads chronologically — Today, then Yesterday, then the longer ranges", () => {
    // Revised 2026-09-18: Graeme wants the row in time order, each option one
    // step further back. The DEFAULT stays Yesterday — order and default are
    // separate decisions, and the next test pins the default.
    expect(PERIOD_PRESETS[0].id).toBe("today");
    expect(PERIOD_PRESETS[1].id).toBe("yesterday");
  });

  it("still defaults to Yesterday — the settled day, not the running one", () => {
    expect(DEFAULT_PERIOD).toBe("yesterday");
  });

  it("keeps all the ranges the page offered before", () => {
    const ids = PERIOD_PRESETS.map((p) => p.id);
    for (const kept of ["today", "last7", "monthToDate", "lastMonth", "last6Months", "last12Months"]) {
      expect(ids).toContain(kept);
    }
  });

  it("defaults to Yesterday", () => {
    expect(DEFAULT_PERIOD).toBe("yesterday");
    expect(PERIOD_PRESETS.some((p) => p.id === DEFAULT_PERIOD)).toBe(true);
  });
});

describe("periodWindow", () => {
  const now = at("2026-09-18T10:00:00Z"); // Friday 18 Sep, London

  it("Yesterday is the single day before today", () => {
    const w = periodWindow("yesterday", now);
    expect(w.from).toBe("2026-09-17");
    expect(w.to).toBe("2026-09-17");
    expect(w.dayCount).toBe(1);
    expect(w.includesToday).toBe(false);
  });

  it("Today is the only period that includes today", () => {
    const w = periodWindow("today", now);
    expect(w.from).toBe("2026-09-18");
    expect(w.to).toBe("2026-09-18");
    expect(w.includesToday).toBe(true);
  });

  it("every other period is full days ending yesterday", () => {
    const ids: PeriodPresetId[] = ["yesterday", "last7", "monthToDate", "lastMonth", "last6Months", "last12Months"];
    for (const id of ids) {
      const w = periodWindow(id, now);
      expect(w.includesToday, id).toBe(false);
      expect(w.days, id).not.toContain("2026-09-18");
      if (!w.empty) expect(w.to <= "2026-09-17", id).toBe(true);
    }
  });

  it("Last 7 days matches the standalone rolling window", () => {
    const w = periodWindow("last7", now);
    const rolling = rollingWindow(now, 7);
    expect(w.from).toBe(rolling.from);
    expect(w.to).toBe(rolling.to);
    expect(w.dayCount).toBe(7);
  });

  it("Month to date runs from the 1st to yesterday", () => {
    const w = periodWindow("monthToDate", now);
    expect(w.from).toBe("2026-09-01");
    expect(w.to).toBe("2026-09-17");
    expect(w.dayCount).toBe(17);
  });

  it("Month to date is honestly EMPTY on the 1st, rather than borrowing last month", () => {
    const w = periodWindow("monthToDate", at("2026-09-01T10:00:00Z"));
    expect(w.empty).toBe(true);
    expect(w.days).toEqual([]);
    expect(w.dayCount).toBe(0);
  });

  it("Month to date is a single day on the 2nd", () => {
    const w = periodWindow("monthToDate", at("2026-09-02T10:00:00Z"));
    expect(w.from).toBe("2026-09-01");
    expect(w.to).toBe("2026-09-01");
    expect(w.dayCount).toBe(1);
  });

  it("Last month is the whole previous calendar month", () => {
    const w = periodWindow("lastMonth", now);
    expect(w.from).toBe("2026-08-01");
    expect(w.to).toBe("2026-08-31");
    expect(w.dayCount).toBe(31);
  });

  it("Last month on the 1st of January reaches back into the previous year", () => {
    const w = periodWindow("lastMonth", at("2026-01-01T10:00:00Z"));
    expect(w.from).toBe("2025-12-01");
    expect(w.to).toBe("2025-12-31");
  });

  it("Last 6 and 12 months end yesterday", () => {
    expect(periodWindow("last6Months", now).from).toBe("2026-03-17");
    expect(periodWindow("last6Months", now).to).toBe("2026-09-17");
    expect(periodWindow("last12Months", now).from).toBe("2025-09-17");
    expect(periodWindow("last12Months", now).to).toBe("2026-09-17");
  });

  it("uses the London day, so late-evening UTC does not lag a day behind", () => {
    // 23:30 UTC on 14 June is 00:30 on the 15th in London.
    const w = periodWindow("yesterday", at("2026-06-14T23:30:00Z"));
    expect(w.from).toBe("2026-06-14");
  });

  it("never produces a day count that disagrees with its own day list", () => {
    for (const p of PERIOD_PRESETS) {
      const w = periodWindow(p.id, now);
      expect(w.days.length, p.id).toBe(w.dayCount);
      expect(w.empty, p.id).toBe(w.dayCount === 0);
    }
  });
});

describe("customWindow", () => {
  const now = at("2026-09-18T10:00:00Z");

  it("takes the typed dates literally", () => {
    const w = customWindow("2026-09-01", "2026-09-05", now);
    expect(w.dayCount).toBe(5);
    expect(w.id).toBe("custom");
    expect(w.includesToday).toBe(false);
  });

  it("knows when the typed range reaches into today", () => {
    expect(customWindow("2026-09-15", "2026-09-18", now).includesToday).toBe(true);
  });

  it("is empty when the dates are the wrong way round", () => {
    expect(customWindow("2026-09-18", "2026-09-01", now).empty).toBe(true);
  });
});

describe("windowRoas over a selected period", () => {
  const now = at("2026-09-18T10:00:00Z");

  it("uses the daily wording for a one-day period with no spend", () => {
    const r = windowRoas({ window: periodWindow("yesterday", now), revenue: 500, spendDays: [] });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toMatch(/no ad spend recorded/i);
  });

  it("computes a one-day period the same as dayRoas", () => {
    const win = periodWindow("yesterday", now);
    const r = windowRoas({ window: win, revenue: 2000, spendDays: [{ date: "2026-09-17", amount: 600 }] });
    const d = dayRoas(2000, 600);
    expect(r.available && d.available).toBe(true);
    if (!r.available || !d.available) return;
    expect(r.percent).toBe(d.percent);
  });

  it("says a period with no complete days has nothing to show", () => {
    const win = periodWindow("monthToDate", at("2026-09-01T10:00:00Z"));
    const r = windowRoas({ window: win, revenue: 500, spendDays: [{ date: "2026-08-31", amount: 100 }] });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toMatch(/no complete days/i);
  });

  it("waits on the missing days of a long period rather than averaging a short one", () => {
    const win = periodWindow("last7", now);
    const spendDays = win.days.slice(0, 4).map((date) => ({ date, amount: 100 }));
    const r = windowRoas({ window: win, revenue: 7000, spendDays });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toBe("Waiting on 3 days of spend");
  });

  it("computes a month-to-date ROAS once every day has spend", () => {
    const win = periodWindow("monthToDate", now); // 1–17 Sep, 17 days
    const spendDays = win.days.map((date) => ({ date, amount: 50 }));
    const r = windowRoas({ window: win, revenue: 3400, spendDays });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.spend).toBe(850);
    expect(r.percent).toBe(400);
  });

  it("still refuses to divide by a whole period of recorded zeroes", () => {
    const win = periodWindow("last7", now);
    const r = windowRoas({ window: win, revenue: 7000, spendDays: win.days.map((date) => ({ date, amount: 0 })) });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toMatch(/nothing to divide by/i);
  });

  it("never returns a non-finite ratio for any preset, however patchy the spend", () => {
    for (const p of PERIOD_PRESETS) {
      const win = periodWindow(p.id, now);
      for (const amount of [0, 100, Number.NaN]) {
        const r = windowRoas({
          window: win,
          revenue: 1000,
          spendDays: win.days.map((date) => ({ date, amount })),
        });
        if (r.available) {
          expect(Number.isFinite(r.ratio), `${p.id} @ ${amount}`).toBe(true);
          expect(Number.isFinite(r.percent), `${p.id} @ ${amount}`).toBe(true);
        }
      }
    }
  });
});
