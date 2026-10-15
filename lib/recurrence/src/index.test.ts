import { describe, expect, it } from "vitest";
import {
  addDays, describeRule, isDailyRhythm, normaliseRule, sameRule, isDueOn, isRecurrenceRule, lastOccurrenceOnOrBefore, mondayOf,
  monthsBetween, nextOccurrenceAfter, occurrencesBetween, weekdayFromName, weekdayOf, type RecurrenceRule,
} from "./index";

// 2026-10-12 is a Monday.
const MON = "2026-10-12", TUE = "2026-10-13", THU = "2026-10-15", SAT = "2026-10-17", SUN = "2026-10-18";

describe("calendar helpers", () => {
  it("knows the weekday of a date", () => {
    expect(weekdayOf(MON)).toBe(1);
    expect(weekdayOf(SUN)).toBe(0);
  });
  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("adds days across both clock changes without slipping a day", () => {
    // BST starts Sun 29 Mar 2026 and ends Sun 25 Oct 2026.
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(weekdayOf("2026-10-25")).toBe(0);
    expect(weekdayOf("2026-03-29")).toBe(0);
  });
  it("finds the Monday of the week (Sunday belongs to the week before)", () => {
    expect(mondayOf(THU)).toBe(MON);
    expect(mondayOf(SUN)).toBe(MON);
    expect(mondayOf(MON)).toBe(MON);
  });
});

describe("isDueOn", () => {
  it("daily is every day", () => {
    for (let i = 0; i < 7; i++) expect(isDueOn({ kind: "daily" }, addDays(MON, i))).toBe(true);
  });
  it("weekdays is Monday to Friday only", () => {
    expect(isDueOn({ kind: "weekdays" }, MON)).toBe(true);
    expect(isDueOn({ kind: "weekdays" }, "2026-10-16")).toBe(true);
    expect(isDueOn({ kind: "weekdays" }, SAT)).toBe(false);
    expect(isDueOn({ kind: "weekdays" }, SUN)).toBe(false);
  });
  it("chosen weekdays (Mon & Thu)", () => {
    const rule: RecurrenceRule = { kind: "weekly", days: [1, 4] };
    expect(occurrencesBetween(rule, MON, SUN)).toEqual([MON, THU]);
  });
  it("weekly on one day (Tue only)", () => {
    const rule: RecurrenceRule = { kind: "weekly", days: [2] };
    expect(isDueOn(rule, TUE)).toBe(true);
    expect(isDueOn(rule, MON)).toBe(false);
  });
  it("weekly with no days never fires", () => {
    expect(occurrencesBetween({ kind: "weekly", days: [] }, MON, addDays(MON, 30))).toEqual([]);
    expect(nextOccurrenceAfter({ kind: "weekly", days: [] }, MON)).toBeNull();
  });
  it("every 2 weeks counts from the anchor's week", () => {
    const rule: RecurrenceRule = { kind: "weekly", days: [5], interval: 2, anchor: "2026-10-14" };
    expect(isDueOn(rule, "2026-10-16")).toBe(true);
    expect(isDueOn(rule, "2026-10-23")).toBe(false);
    expect(isDueOn(rule, "2026-10-30")).toBe(true);
    expect(isDueOn(rule, "2026-10-09")).toBe(false); // a fortnight's parity backwards too
    expect(isDueOn(rule, "2026-10-02")).toBe(true);
  });
  it("every 2 weeks keeps its parity across the October clock change", () => {
    const rule: RecurrenceRule = { kind: "weekly", days: [1], interval: 2, anchor: "2026-10-19" };
    expect(occurrencesBetween(rule, "2026-10-12", "2026-11-16")).toEqual(["2026-10-19", "2026-11-02", "2026-11-16"]);
  });
  it("every N weeks without an anchor is every week", () => {
    expect(isDueOn({ kind: "weekly", days: [1], interval: 3 }, MON)).toBe(true);
  });
  it("monthly on day N, falling back to the month's last day", () => {
    expect(isDueOn({ kind: "monthly", dayOfMonth: 15 }, "2026-10-15")).toBe(true);
    expect(isDueOn({ kind: "monthly", dayOfMonth: 15 }, "2026-10-16")).toBe(false);
    expect(isDueOn({ kind: "monthly", dayOfMonth: 31 }, "2026-02-28")).toBe(true);
    expect(isDueOn({ kind: "monthly", dayOfMonth: 31 }, "2028-02-29")).toBe(true); // leap year
    expect(isDueOn({ kind: "monthly", dayOfMonth: 31 }, "2028-02-28")).toBe(false);
    expect(isDueOn({ kind: "monthly", dayOfMonth: 31 }, "2026-04-30")).toBe(true);
  });
});

describe("occurrence search", () => {
  it("finds the latest occurrence on or before a date", () => {
    expect(lastOccurrenceOnOrBefore({ kind: "weekly", days: [2] }, "2026-10-16")).toBe(TUE);
    expect(lastOccurrenceOnOrBefore({ kind: "weekly", days: [2] }, TUE)).toBe(TUE);
  });
  it("ignores occurrences before notBefore", () => {
    expect(lastOccurrenceOnOrBefore({ kind: "weekly", days: [2] }, "2026-10-16", "2026-10-14")).toBeNull();
  });
  it("finds the next occurrence", () => {
    expect(nextOccurrenceAfter({ kind: "weekly", days: [2] }, TUE)).toBe("2026-10-20");
    expect(nextOccurrenceAfter({ kind: "monthly", dayOfMonth: 1 }, TUE)).toBe("2026-11-01");
  });
});

describe("describeRule", () => {
  it("reads like a person would say it", () => {
    expect(describeRule({ kind: "daily" })).toBe("Every day");
    expect(describeRule({ kind: "weekly", days: [4, 1] })).toBe("Every Mon & Thu");
    expect(describeRule({ kind: "weekly", days: [0, 1, 3] })).toBe("Every Mon, Wed & Sun");
    expect(describeRule({ kind: "weekly", days: [5], interval: 2 })).toBe("Every 2 weeks on Fri");
    expect(describeRule({ kind: "monthly", dayOfMonth: 1 })).toBe("Monthly on the 1st");
    expect(describeRule({ kind: "monthly", dayOfMonth: 22 })).toBe("Monthly on the 22nd");
    expect(describeRule({ kind: "monthly", dayOfMonth: 13 })).toBe("Monthly on the 13th");
  });
});

describe("isRecurrenceRule", () => {
  it("accepts the four kinds and rejects junk", () => {
    expect(isRecurrenceRule({ kind: "daily" })).toBe(true);
    expect(isRecurrenceRule({ kind: "weekly", days: [1, 4], interval: 2, anchor: "2026-10-12" })).toBe(true);
    expect(isRecurrenceRule({ kind: "weekly", days: [7] })).toBe(false);
    expect(isRecurrenceRule({ kind: "weekly", days: [1], anchor: "2026-13-01" })).toBe(false);
    expect(isRecurrenceRule({ kind: "monthly", dayOfMonth: 0 })).toBe(false);
    expect(isRecurrenceRule({ kind: "yearly" })).toBe(false);
    expect(isRecurrenceRule(null)).toBe(false);
  });
  it("maps stored weekday names", () => {
    expect(weekdayFromName("Thursday")).toBe(4);
    expect(weekdayFromName("funday")).toBeNull();
  });
});

describe("normaliseRule / sameRule", () => {
  it("treats key order, day order and a redundant interval as the same rule", () => {
    expect(sameRule({ kind: "weekly", days: [4, 1, 1] }, { days: [1, 4], kind: "weekly", interval: 1 } as never)).toBe(true);
    expect(sameRule({ kind: "weekly", days: [1], interval: 2, anchor: "2026-10-12" }, { kind: "weekly", days: [1], interval: 2, anchor: "2026-10-19" })).toBe(false);
    expect(normaliseRule({ kind: "weekly", days: [1], interval: 1, anchor: "2026-10-12" })).toEqual({ kind: "weekly", days: [1] });
  });
  it("daily and weekdays are the daily rhythms", () => {
    expect(isDailyRhythm({ kind: "weekdays" })).toBe(true);
    expect(isDailyRhythm({ kind: "weekly", days: [1, 2, 3, 4, 5] })).toBe(false);
  });
});

describe("once (one-off items, e.g. a short-delivery report)", () => {
  const rule: RecurrenceRule = { kind: "once", date: THU };
  it("is due on its day only", () => {
    expect(isDueOn(rule, THU)).toBe(true);
    expect(isDueOn(rule, SAT)).toBe(false);
    expect(nextOccurrenceAfter(rule, THU)).toBeNull();
    expect(lastOccurrenceOnOrBefore(rule, SUN, THU)).toBe(THU);
  });
  it("is a valid rule, normalises and reads in plain English", () => {
    expect(isRecurrenceRule(rule)).toBe(true);
    expect(isRecurrenceRule({ kind: "once", date: "15/10/2026" })).toBe(false);
    expect(normaliseRule(rule)).toEqual(rule);
    expect(describeRule(rule)).toBe("Once, on Thu 15 Oct");
    expect(isDailyRhythm(rule)).toBe(false);
  });
});

// ── Every N months (Graeme, 2026-10-15: maintenance every 3, 4 or 6 months) ─
describe("every N months", () => {
  const six = { kind: "monthly" as const, dayOfMonth: 1, interval: 6, anchor: "2026-11-01" };
  it("is due on the day in the anchor month and every N months after (and before)", () => {
    expect(isDueOn(six, "2026-11-01")).toBe(true);
    expect(isDueOn(six, "2027-05-01")).toBe(true);
    expect(isDueOn(six, "2026-05-01")).toBe(true);
    expect(isDueOn(six, "2026-12-01")).toBe(false);
    expect(isDueOn(six, "2027-02-01")).toBe(false);
    expect(isDueOn(six, "2026-11-02")).toBe(false);
  });
  it("quarterly and every 4 months", () => {
    const q = { kind: "monthly" as const, dayOfMonth: 15, interval: 3, anchor: "2026-10-15" };
    expect(occurrencesBetween(q, "2026-10-01", "2027-07-31")).toEqual(["2026-10-15", "2027-01-15", "2027-04-15", "2027-07-15"]);
    const four = { kind: "monthly" as const, dayOfMonth: 31, interval: 4, anchor: "2026-10-01" };
    expect(occurrencesBetween(four, "2026-10-01", "2027-06-30")).toEqual(["2026-10-31", "2027-02-28", "2027-06-30"]);
  });
  it("yearly finds its next and last occurrence a year apart", () => {
    const y = { kind: "monthly" as const, dayOfMonth: 10, interval: 12, anchor: "2026-03-10" };
    expect(nextOccurrenceAfter(y, "2026-03-10")).toBe("2027-03-10");
    expect(lastOccurrenceOnOrBefore(y, "2027-03-09")).toBe("2026-03-10");
  });
  it("describes, normalises and validates", () => {
    expect(describeRule(six)).toBe("Every 6 months on the 1st — May & Nov");
    expect(describeRule({ kind: "monthly", dayOfMonth: 2, interval: 12, anchor: "2026-01-05" })).toBe("Yearly on the 2nd — Jan");
    expect(describeRule({ kind: "monthly", dayOfMonth: 2 })).toBe("Monthly on the 2nd");
    expect(normaliseRule({ kind: "monthly", dayOfMonth: 2, interval: 1, anchor: "2026-01-05" })).toEqual({ kind: "monthly", dayOfMonth: 2 });
    expect(isRecurrenceRule(six)).toBe(true);
    expect(isRecurrenceRule({ ...six, interval: 13 })).toBe(false);
    expect(monthsBetween("2026-11-30", "2027-05-01")).toBe(6);
  });
});
