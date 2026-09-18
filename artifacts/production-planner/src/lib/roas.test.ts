import { describe, it, expect } from "vitest";
import {
  addDays,
  dayRoas,
  daysBetween,
  londonDayString,
  rollingWindow,
  windowRoas,
  yesterdayLondon,
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
