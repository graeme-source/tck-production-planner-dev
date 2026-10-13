import { describe, it, expect } from "vitest";
import {
  DEFAULT_STOCK_CHECK_DEADLINE,
  DEFAULT_STOCK_CHECK_WARN_FROM,
  deadlineLabel,
  isPrepDayToday,
  londonClock,
  minutesLeftText,
  outstandingStockChecks,
  stockCheckAlarmHeadline,
  stockCheckAlarmState,
  stockCheckAlarmWindow,
} from "./stock-check-alarm";

const at = (hhmm: string, ss = 0) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 3600 + m * 60 + ss;
};
const window = { warnFrom: "14:45", deadline: "15:00" };

describe("stockCheckAlarmState — by time and outstanding count (Graeme, 13 Oct 2026)", () => {
  const base = { dueCount: 5, outstandingCount: 2, prepDay: true, window };

  it("before 14:45 stays amber", () => {
    expect(stockCheckAlarmState({ ...base, secondsOfDay: at("14:44", 59) })).toBe("pending");
    expect(stockCheckAlarmState({ ...base, secondsOfDay: at("09:00") })).toBe("pending");
  });

  it("from 14:45 until 15:00 flashes red", () => {
    expect(stockCheckAlarmState({ ...base, secondsOfDay: at("14:45") })).toBe("warning");
    expect(stockCheckAlarmState({ ...base, secondsOfDay: at("14:59", 59) })).toBe("warning");
  });

  it("from 15:00 is overdue", () => {
    expect(stockCheckAlarmState({ ...base, secondsOfDay: at("15:00") })).toBe("overdue");
    expect(stockCheckAlarmState({ ...base, secondsOfDay: at("17:30") })).toBe("overdue");
  });

  it("green as soon as nothing is outstanding, whatever the time", () => {
    for (const t of ["10:00", "14:50", "16:00"]) {
      expect(stockCheckAlarmState({ ...base, outstandingCount: 0, secondsOfDay: at(t) })).toBe("done");
    }
  });

  it("nothing due → no panel", () => {
    expect(stockCheckAlarmState({ ...base, dueCount: 0, outstandingCount: 0, secondsOfDay: at("14:50") })).toBe("none");
  });

  it("never goes red on a day with no prep", () => {
    for (const t of ["14:50", "16:00"]) {
      expect(stockCheckAlarmState({ ...base, prepDay: false, secondsOfDay: at(t) })).toBe("pending");
    }
  });
});

describe("isPrepDayToday — prep-day gating", () => {
  const today = "2026-10-13";

  it("live plan whose prep is today", () => {
    expect(isPrepDayToday({ planDate: "2026-10-14", prepDate: "2026-10-13", status: "active" }, today)).toBe(true);
  });

  it("legacy row with no prep_date falls back to plan_date (as /next-active does)", () => {
    expect(isPrepDayToday({ planDate: "2026-10-13", prepDate: null, status: "active" }, today)).toBe(true);
    expect(isPrepDayToday({ planDate: "2026-10-14", prepDate: null, status: "active" }, today)).toBe(false);
  });

  it("prep for a later day is not today", () => {
    expect(isPrepDayToday({ planDate: "2026-10-16", prepDate: "2026-10-15", status: "active" }, today)).toBe(false);
  });

  it("draft, complete or missing plans are not live", () => {
    expect(isPrepDayToday({ planDate: "2026-10-14", prepDate: "2026-10-13", status: "draft" }, today)).toBe(false);
    expect(isPrepDayToday({ planDate: "2026-10-14", prepDate: "2026-10-13", status: "complete" }, today)).toBe(false);
    expect(isPrepDayToday(null, today)).toBe(false);
  });
});

describe("minutesLeftText", () => {
  it("rounds up to whole minutes", () => {
    expect(minutesLeftText(15 * 60)).toBe("15 min left");
    expect(minutesLeftText(11 * 60 + 30)).toBe("12 min left");
    expect(minutesLeftText(61)).toBe("2 min left");
    expect(minutesLeftText(60)).toBe("1 min left");
  });

  it("last minute and after", () => {
    expect(minutesLeftText(59)).toBe("under 1 min left");
    expect(minutesLeftText(0)).toBe("0 min left");
    expect(minutesLeftText(-5)).toBe("0 min left");
  });
});

describe("wording per state", () => {
  const h = (state: Parameters<typeof stockCheckAlarmHeadline>[0]["state"], outstandingCount: number, t = "14:48") =>
    stockCheckAlarmHeadline({ state, dueCount: 6, outstandingCount, secondsOfDay: at(t, 30), window });

  it("matches Graeme's wording", () => {
    expect(h("pending", 2)).toBe("2 of 6 stock checks outstanding for today");
    expect(h("warning", 2)).toBe("Stock checks due by 3:00 — 2 still to record · 12 min left");
    expect(h("overdue", 2, "15:10")).toBe("Overdue — 2 stock checks not recorded");
    expect(h("overdue", 1, "15:10")).toBe("Overdue — 1 stock check not recorded");
    expect(h("done", 0)).toBe("All 6 stock checks recorded for today");
  });

  it("deadlineLabel speaks kitchen time", () => {
    expect(deadlineLabel("15:00")).toBe("3:00");
    expect(deadlineLabel("09:30")).toBe("9:30");
    expect(deadlineLabel("12:15")).toBe("12:15");
    expect(deadlineLabel("00:05")).toBe("12:05");
  });
});

describe("stockCheckAlarmWindow — times from the prep reminder setting", () => {
  const prepReminder = { id: "x", enabled: true, stations: ["prep"], startTime: "14:30", endTime: "15:15", onlyIfStockChecksOutstanding: true };

  it("uses the prep stock-check reminder's times", () => {
    expect(stockCheckAlarmWindow([prepReminder])).toEqual({ warnFrom: "14:30", deadline: "15:15" });
  });

  it("prefers an enabled reminder over a disabled one", () => {
    const off = { ...prepReminder, enabled: false, startTime: "13:00", endTime: "13:30" };
    expect(stockCheckAlarmWindow([off, prepReminder])).toEqual({ warnFrom: "14:30", deadline: "15:15" });
    expect(stockCheckAlarmWindow([off])).toEqual({ warnFrom: "13:00", deadline: "13:30" });
  });

  it("ignores reminders that aren't the prep stock-check one", () => {
    const packing = { ...prepReminder, stations: ["packing"], startTime: "10:00", endTime: "11:00" };
    const noFlag = { ...prepReminder, onlyIfStockChecksOutstanding: false };
    const backwards = { ...prepReminder, startTime: "16:00", endTime: "15:00" };
    expect(stockCheckAlarmWindow([packing, noFlag, backwards]))
      .toEqual({ warnFrom: DEFAULT_STOCK_CHECK_WARN_FROM, deadline: DEFAULT_STOCK_CHECK_DEADLINE });
  });

  it("defaults are 14:45 → 15:00", () => {
    expect(stockCheckAlarmWindow([])).toEqual({ warnFrom: "14:45", deadline: "15:00" });
  });
});

describe("outstandingStockChecks + londonClock", () => {
  const items = [
    { id: 1, name: "Passata (Rodolfi)", stockCheckFrequency: "weekly", stockCheckDay: "Tuesday" },
    { id: 2, name: "Tomato Puree", stockCheckFrequency: "weekly", stockCheckDay: "Tuesday" },
    { id: 3, name: "Mozzarella", stockCheckFrequency: "daily", stockCheckDay: null },
    { id: 4, name: "Oregano", stockCheckFrequency: "weekly", stockCheckDay: "Friday" },
  ];

  it("weekly checks only on their day; recorded ones drop out", () => {
    expect(outstandingStockChecks(items, new Set([3]), "Tuesday").map(i => i.name)).toEqual(["Passata (Rodolfi)", "Tomato Puree"]);
    expect(outstandingStockChecks(items, new Set(), "Wednesday").map(i => i.id)).toEqual([3]);
  });

  it("London clock, not the device's zone (BST)", () => {
    const c = londonClock(new Date("2026-10-13T13:45:30Z"));
    expect(c).toEqual({ dateStr: "2026-10-13", dayName: "Tuesday", secondsOfDay: at("14:45", 30) });
    expect(londonClock(new Date("2026-10-13T23:30:00Z")).dateStr).toBe("2026-10-14");
  });
});
