import { describe, expect, it } from "vitest";
import { changeDay, changeLine, changeTime, dayHeading, groupChangesByDay, impactTag, type ChangeLogEntry } from "./change-log";

const label = (c: string) => ({ offer: "Offer", theme: "Website", email: "Email" }[c] ?? c);
const entry = (id: number, effectiveAt: string, extra: Partial<ChangeLogEntry> = {}): ChangeLogEntry =>
  ({ id, effectiveAt, category: "offer", title: `Change ${id}`, impact: null, ...extra });

describe("change log lines", () => {
  it("one short line: category · title, in full", () => {
    expect(changeLine(entry(1, "2026-10-21T08:14:00Z", { title: "Free delivery threshold £60 → £50" }), label))
      .toBe("Offer · Free delivery threshold £60 → £50");
    const long = "A".repeat(300);
    expect(changeLine(entry(2, "2026-10-21T08:14:00Z", { title: long, category: "theme" }), label)).toBe(`Website · ${long}`);
  });

  it("times and days are London's (BST in October, GMT in winter)", () => {
    expect(changeTime("2026-10-21T08:14:00Z")).toBe("09:14");
    expect(changeTime("2026-12-01T08:14:00Z")).toBe("08:14");
    // 23:30 UTC on the 21st is 00:30 on the 22nd in London (BST).
    expect(changeDay("2026-10-21T23:30:00Z")).toBe("2026-10-22");
  });

  it("day headings: Today, this year without the year, other years with it", () => {
    expect(dayHeading("2026-10-21", "2026-10-21")).toBe("Today · Wed 21 Oct");
    expect(dayHeading("2026-10-20", "2026-10-21")).toBe("Tue 20 Oct");
    expect(dayHeading("2025-12-30", "2026-01-05")).toBe("Tue 30 Dec 2025");
  });
});

describe("impact tag", () => {
  it("says nothing when there's nothing to say", () => {
    expect(impactTag(null)).toBeNull();
    expect(impactTag({ effect: null, likelihood: "not enough data yet", leadShift: null })).toBeNull();
    expect(impactTag({ effect: 0.02, likelihood: "no clear difference", leadShift: null })).toBeNull();
  });

  it("a short tag when conversion moved", () => {
    expect(impactTag({ effect: -0.123, likelihood: "likely lower", leadShift: null }))
      .toEqual({ text: "Conversion likely lower after (−12%)", worse: true });
    expect(impactTag({ effect: 0.08, likelihood: "possibly higher", leadShift: 0.2 }))
      .toEqual({ text: "Conversion possibly higher after (+8%)", worse: false });
  });

  it("mentions the delivery wait when it moved as well", () => {
    expect(impactTag({ effect: -0.2, likelihood: "very likely lower", leadShift: 1.24 })?.text)
      .toBe("Conversion very likely lower after (−20%) · delivery wait +1.2 days too");
  });
});

describe("grouping by day", () => {
  it("newest day first, newest first within a day, every entry kept", () => {
    const changes = [
      entry(1, "2026-10-19T09:00:00Z"),
      entry(2, "2026-10-21T07:00:00Z"),
      entry(3, "2026-10-21T15:00:00Z"),
      entry(4, "2026-10-20T10:00:00Z"),
      entry(5, "2026-10-21T15:00:00Z"),
    ];
    const days = groupChangesByDay(changes, "2026-10-21");
    expect(days.map(d => d.day)).toEqual(["2026-10-21", "2026-10-20", "2026-10-19"]);
    expect(days[0].heading).toBe("Today · Wed 21 Oct");
    expect(days[0].entries.map(e => e.id)).toEqual([5, 3, 2]);
    expect(days.flatMap(d => d.entries)).toHaveLength(changes.length);
  });

  it("empty in, empty out", () => {
    expect(groupChangesByDay([], "2026-10-21")).toEqual([]);
  });
});
