import { describe, it, expect } from "vitest";
import {
  addDays, daysBetween, monthGridWeeks, assignLanes, layoutWeek, applyDrag, pixelsToDays,
  timelineRange, formatRange, addMonths, mondayIndex,
  describeDateChange, diffFields, describeFieldChanges, historyLine,
} from "./index";

describe("day maths", () => {
  it("adds days across month and year ends and clock changes", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26"); // BST ends 25 Oct
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2); // BST starts 29 Mar
  });
  it("adds months", () => {
    expect(addMonths("2026-11-15", 1)).toBe("2026-12-01");
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
  });
  it("weeks start on Monday", () => {
    expect(mondayIndex("2026-09-28")).toBe(0); // Monday
    expect(mondayIndex("2026-10-04")).toBe(6); // Sunday
  });
});

describe("monthGridWeeks", () => {
  it("covers October 2026 in Monday-start rows", () => {
    const weeks = monthGridWeeks("2026-10-16");
    expect(weeks[0][0]).toBe("2026-09-28");
    expect(weeks[weeks.length - 1][6]).toBe("2026-11-01");
    expect(weeks).toHaveLength(5);
    expect(weeks.every(w => w.length === 7)).toBe(true);
  });
});

describe("assignLanes", () => {
  it("never puts overlapping events in the same lane", () => {
    const lanes = assignLanes([
      { id: 1, startDate: "2026-10-01", endDate: "2026-10-10" },
      { id: 2, startDate: "2026-10-05", endDate: "2026-10-06" },
      { id: 3, startDate: "2026-10-11", endDate: "2026-10-12" },
      { id: 4, startDate: "2026-10-06", endDate: "2026-10-11" },
    ]);
    expect(lanes.get(1)).toBe(0);
    expect(lanes.get(2)).toBe(1);
    expect(lanes.get(3)).toBe(0); // starts after 1 ends → reuses lane 0
    expect(lanes.get(4)).toBe(2); // clashes with 1 (to 10th) and 2 (6th)
  });
  it("counts touching on the same day as overlapping", () => {
    const lanes = assignLanes([
      { id: 1, startDate: "2026-10-01", endDate: "2026-10-05" },
      { id: 2, startDate: "2026-10-05", endDate: "2026-10-07" },
    ]);
    expect(lanes.get(2)).toBe(1);
  });
});

describe("layoutWeek", () => {
  const week = monthGridWeeks("2026-10-01")[2]; // Mon 12 – Sun 18 Oct
  it("cuts a multi-week event at the week edges so it wraps", () => {
    const { segments, laneCount } = layoutWeek(week, [
      { id: 7, startDate: "2026-10-08", endDate: "2026-10-21" },
      { id: 8, startDate: "2026-10-14", endDate: "2026-10-14" },
      { id: 9, startDate: "2026-11-01", endDate: "2026-11-02" },
    ]);
    expect(segments).toHaveLength(2);
    const long = segments.find(s => s.event.id === 7)!;
    expect(long).toMatchObject({ startCol: 0, endCol: 6, continuesBefore: true, continuesAfter: true, lane: 0 });
    const single = segments.find(s => s.event.id === 8)!;
    expect(single).toMatchObject({ startCol: 2, endCol: 2, continuesBefore: false, continuesAfter: false, lane: 1 });
    expect(laneCount).toBe(2);
  });
  it("an empty week has no lanes", () => {
    expect(layoutWeek(week, []).laneCount).toBe(0);
  });
});

describe("applyDrag", () => {
  const span = { startDate: "2026-10-16", endDate: "2026-10-29" };
  it("move shifts both ends and keeps the length", () => {
    expect(applyDrag(span, "move", 2)).toEqual({ startDate: "2026-10-18", endDate: "2026-10-31" });
    expect(applyDrag(span, "move", -16)).toEqual({ startDate: "2026-09-30", endDate: "2026-10-13" });
  });
  it("resize-end stretches or shrinks, never before the start", () => {
    expect(applyDrag(span, "resize-end", 3)).toEqual({ startDate: "2026-10-16", endDate: "2026-11-01" });
    expect(applyDrag(span, "resize-end", -30)).toEqual({ startDate: "2026-10-16", endDate: "2026-10-16" });
  });
  it("resize-start never passes the end", () => {
    expect(applyDrag(span, "resize-start", -2)).toEqual({ startDate: "2026-10-14", endDate: "2026-10-29" });
    expect(applyDrag(span, "resize-start", 40)).toEqual({ startDate: "2026-10-29", endDate: "2026-10-29" });
  });
  it("pixels round to the nearest day", () => {
    expect(pixelsToDays(50, 36)).toBe(1);
    expect(pixelsToDays(17, 36)).toBe(0);
    expect(pixelsToDays(-17, 36)).toBe(0);
    expect(Object.is(pixelsToDays(-10, 36), -0)).toBe(false);
    expect(pixelsToDays(-80, 36)).toBe(-2);
  });
});

describe("timelineRange", () => {
  it("runs Monday to Sunday around whole months", () => {
    const r = timelineRange("2026-10-16", 3);
    expect(r.from).toBe("2026-09-28");
    expect(r.to).toBe("2027-01-03");
    expect(r.days).toBe(daysBetween(r.from, r.to) + 1);
    expect(r.days % 7).toBe(0);
  });
});

describe("formatRange", () => {
  it("reads like a person would write it", () => {
    expect(formatRange("2026-10-16", "2026-10-29")).toBe("16–29 Oct");
    expect(formatRange("2026-10-28", "2026-11-03")).toBe("28 Oct – 3 Nov");
    expect(formatRange("2026-10-18", "2026-10-18")).toBe("18 Oct");
    expect(formatRange("2026-12-28", "2027-01-03")).toBe("28 Dec 2026 – 3 Jan 2027");
  });
});

describe("history summaries", () => {
  it("a same-length change is a move", () => {
    expect(describeDateChange(
      { startDate: "2026-10-16", endDate: "2026-10-29" },
      { startDate: "2026-10-18", endDate: "2026-10-31" },
    )).toEqual({ action: "moved", summary: "moved it from 16–29 Oct to 18–31 Oct" });
  });
  it("a longer or shorter one is a resize", () => {
    expect(describeDateChange(
      { startDate: "2026-10-16", endDate: "2026-10-29" },
      { startDate: "2026-10-16", endDate: "2026-11-02" },
    )).toEqual({ action: "resized", summary: "stretched it from 16–29 Oct to 16 Oct – 2 Nov" });
    expect(describeDateChange(
      { startDate: "2026-10-16", endDate: "2026-10-29" },
      { startDate: "2026-10-20", endDate: "2026-10-29" },
    )?.summary).toBe("shortened it from 16–29 Oct to 20–29 Oct");
  });
  it("no change → nothing to record", () => {
    expect(describeDateChange({ startDate: "2026-10-16", endDate: "2026-10-29" }, { startDate: "2026-10-16", endDate: "2026-10-29" })).toBeNull();
  });
  it("only real field changes are recorded", () => {
    const changes = diffFields(
      { name: "Bonfire", notes: "a", status: "idea", channels: ["social"], summary: null },
      { name: "Bonfire", notes: "b", status: "planned", channels: ["social"], summary: "", unknown: "x" },
    );
    expect(Object.keys(changes)).toEqual(["notes", "status"]);
    expect(describeFieldChanges(changes)).toBe("edited the notes and changed the status to planned");
  });
  it("names renames, channels and clears", () => {
    expect(describeFieldChanges({
      name: { from: "A", to: "Bonfire Box" },
      channels: { from: [], to: ["vip_email", "social"] },
      offer: { from: "x", to: "" },
    })).toBe("renamed it to “Bonfire Box”, set the channels to vip email, social and cleared the offer details");
    expect(describeFieldChanges({})).toBeNull();
  });
  it("history lines use the first name", () => {
    expect(historyLine("Tommy Smith", "moved it from 16–29 Oct to 18–31 Oct")).toBe("Tommy moved it from 16–29 Oct to 18–31 Oct");
    expect(historyLine(null, "added this")).toBe("Someone added this");
  });
});
