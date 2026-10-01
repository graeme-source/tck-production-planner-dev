import { describe, it, expect } from "vitest";
import {
  cutoffStatus,
  cutoffLabel,
  sortByCutoff,
  formatCutoffTime,
  formatTimeLeft,
  londonClock,
  parseCutoff,
  tickIntervalMs,
  type SupplierCutoffInfo,
} from "./supplier-cutoff";

// Instants are given in UTC so the tests mean the same thing on any machine.
// Thu 1 Oct 2026 is British Summer Time (UTC+1): 15:25 London = 14:25Z.
const BST_1525 = new Date("2026-10-01T14:25:00Z");
// Thu 3 Dec 2026 is GMT (UTC+0): 15:25 London = 15:25Z.
const GMT_1525 = new Date("2026-12-03T15:25:00Z");

const daily = (cutoffTime: string | null): SupplierCutoffInfo => ({ cutoffTime, orderFrequency: "daily", orderDays: null });

describe("londonClock", () => {
  it("reads London wall time in summer and winter, not the machine's offset", () => {
    expect(londonClock(BST_1525)).toMatchObject({ weekday: "Thursday", msOfDay: (15 * 60 + 25) * 60_000 });
    expect(londonClock(GMT_1525)).toMatchObject({ weekday: "Thursday", msOfDay: (15 * 60 + 25) * 60_000 });
  });

  it("puts 23:30Z on a summer Wednesday into London's Thursday", () => {
    expect(londonClock(new Date("2026-09-30T23:30:00Z")).weekday).toBe("Thursday");
  });
});

describe("cutoffStatus", () => {
  it("15:25 with a 16:00 cut-off → 35 min left (amber)", () => {
    const s = cutoffStatus(daily("16:00"), BST_1525);
    expect(s).toMatchObject({ kind: "open", cutoffMinutes: 960, msLeft: 35 * 60_000, urgency: "soon" });
    expect(cutoffLabel(s)).toBe("Cut-off 4pm · order within 35 min");
  });

  it("gives the same answer on a winter (GMT) day", () => {
    const s = cutoffStatus(daily("16:00"), GMT_1525);
    expect(s).toMatchObject({ kind: "open", msLeft: 35 * 60_000 });
  });

  it("red within 30 minutes", () => {
    expect(cutoffStatus(daily("15:55"), BST_1525)).toMatchObject({ kind: "open", urgency: "urgent" });
  });

  it("amber within 2 hours, calm beyond", () => {
    expect(cutoffStatus(daily("17:00"), BST_1525)).toMatchObject({ kind: "open", urgency: "soon" });
    expect(cutoffStatus(daily("17:30"), BST_1525)).toMatchObject({ kind: "open", urgency: "calm" });
  });

  it("is passed at and after the cut-off minute", () => {
    expect(cutoffStatus(daily("15:25"), BST_1525).kind).toBe("passed");
    expect(cutoffStatus(daily("12:00"), BST_1525).kind).toBe("passed");
  });

  it("treats a missing or unreadable cut-off as no deadline", () => {
    expect(cutoffStatus(daily(null), BST_1525)).toMatchObject({ kind: "none", reason: "no-cutoff" });
    expect(cutoffStatus(daily(""), BST_1525)).toMatchObject({ kind: "none", reason: "no-cutoff" });
    expect(cutoffStatus(daily("soon"), BST_1525)).toMatchObject({ kind: "none", reason: "no-cutoff" });
  });

  it("weekly supplier not ordering today has no deadline today", () => {
    const tuesdayOnly = { cutoffTime: "17:00", orderFrequency: "weekly", orderDays: "Tuesday" };
    const s = cutoffStatus(tuesdayOnly, BST_1525);
    expect(s).toMatchObject({ kind: "none", reason: "not-order-day" });
    expect(cutoffLabel(s)).toBe("Orders on Tue only — no cut-off today");
  });

  it("weekly supplier on its order day counts down like any other", () => {
    const monThu = { cutoffTime: "16:00", orderFrequency: "weekly", orderDays: "Monday,Thursday" };
    expect(cutoffStatus(monThu, BST_1525)).toMatchObject({ kind: "open", msLeft: 35 * 60_000 });
  });

  it("order days are ignored for a daily supplier (stale data from a frequency switch)", () => {
    const stale = { cutoffTime: "16:00", orderFrequency: "daily", orderDays: "Tuesday" };
    expect(cutoffStatus(stale, BST_1525).kind).toBe("open");
  });

  it("weekends have no deadline, unless a weekly supplier orders that day", () => {
    const saturday = new Date("2026-10-03T10:00:00Z"); // 11:00 London
    expect(cutoffStatus(daily("16:00"), saturday)).toMatchObject({ kind: "none", reason: "weekend" });
    const satOrders = { cutoffTime: "16:00", orderFrequency: "weekly", orderDays: "Saturday" };
    expect(cutoffStatus(satOrders, saturday).kind).toBe("open");
  });
});

describe("sortByCutoff", () => {
  it("soonest cut-off first, then no deadline, then passed — ties keep their order", () => {
    const cards = [
      { name: "a-17", info: daily("17:00") },
      { name: "b-passed", info: daily("12:00") },
      { name: "c-none", info: daily(null) },
      { name: "d-16", info: daily("16:00") },
      { name: "e-weekly-off", info: { cutoffTime: "16:00", orderFrequency: "weekly", orderDays: "Tuesday" } },
      { name: "f-17", info: daily("17:00") },
      { name: "g-passed", info: daily("09:00") },
    ];
    const sorted = sortByCutoff(cards, c => cutoffStatus(c.info, BST_1525)).map(c => c.name);
    expect(sorted).toEqual(["d-16", "a-17", "f-17", "c-none", "e-weekly-off", "b-passed", "g-passed"]);
  });

  it("does not mutate the input", () => {
    const cards = [daily("17:00"), daily("16:00")];
    sortByCutoff(cards, c => cutoffStatus(c, BST_1525));
    expect(cards[0].cutoffTime).toBe("17:00");
  });
});

describe("labels", () => {
  it("formats cut-off times the way people say them", () => {
    expect(formatCutoffTime(960)).toBe("4pm");
    expect(formatCutoffTime(990)).toBe("4:30pm");
    expect(formatCutoffTime(720)).toBe("12pm");
    expect(formatCutoffTime(0)).toBe("12am");
    expect(formatCutoffTime(parseCutoff("09:05")!)).toBe("9:05am");
  });

  it("rounds time left down, with seconds only in the last 10 minutes", () => {
    expect(formatTimeLeft(2 * 3600_000 + 5 * 60_000 + 59_000)).toBe("2 h 05 min");
    expect(formatTimeLeft(35 * 60_000 + 59_000)).toBe("35 min");
    expect(formatTimeLeft(9 * 60_000 + 42_000)).toBe("9 min 42 s");
    expect(formatTimeLeft(42_000)).toBe("42 s");
  });

  it("passed cut-off names the later delivery day", () => {
    const s = cutoffStatus(daily("12:00"), BST_1525);
    expect(cutoffLabel(s, "Mon 5 Oct")).toBe("Cut-off 12pm passed — ordering now arrives Mon 5 Oct");
  });

  it("ticks every second near the end, every 30 s otherwise", () => {
    expect(tickIntervalMs(cutoffStatus(daily("15:30"), BST_1525))).toBe(1_000);
    expect(tickIntervalMs(cutoffStatus(daily("17:00"), BST_1525))).toBe(30_000);
    expect(tickIntervalMs(cutoffStatus(daily("12:00"), BST_1525))).toBe(60_000);
  });
});
