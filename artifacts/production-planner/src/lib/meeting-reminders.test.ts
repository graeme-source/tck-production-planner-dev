import { describe, it, expect } from "vitest";
import { withStandingRemindersSlide, reminderLinesFromNote, STANDING_REMINDERS_KIND } from "./meeting-reminders";

const s = (id: number, kind: string) => ({ id, kind, title: kind, orderPosition: id });
const make = (x: { id: number; kind: string; title: string; orderPosition: number }) => ({ ...x });
const kinds = (list: Array<{ kind: string }>) => list.map(x => x.kind);

describe("withStandingRemindersSlide", () => {
  it("goes straight after the Safety slide", () => {
    const out = withStandingRemindersSlide([s(1, "stretches"), s(2, "safety_issues"), s(3, "lesson"), s(4, "gratitude")], make);
    expect(kinds(out)).toEqual(["stretches", "safety_issues", STANDING_REMINDERS_KIND, "lesson", "gratitude"]);
  });
  it("else just before Gratitude, else at the end", () => {
    expect(kinds(withStandingRemindersSlide([s(1, "lesson"), s(2, "gratitude")], make)))
      .toEqual(["lesson", STANDING_REMINDERS_KIND, "gratitude"]);
    expect(kinds(withStandingRemindersSlide([s(1, "lesson")], make)))
      .toEqual(["lesson", STANDING_REMINDERS_KIND]);
  });
  it("adds nothing to an empty meeting or one that already has it", () => {
    expect(withStandingRemindersSlide([], make)).toEqual([]);
    const already = [s(1, "lesson"), s(2, STANDING_REMINDERS_KIND)];
    expect(withStandingRemindersSlide(already, make)).toHaveLength(2);
  });
  it("never changes the input list", () => {
    const list = [s(1, "safety_issues")];
    withStandingRemindersSlide(list, make);
    expect(list).toHaveLength(1);
  });
});

describe("reminderLinesFromNote", () => {
  it("splits an old per-day note into one reminder per line", () => {
    expect(reminderLinesFromNote("- Fire alarm test at 11\n\n* **Visitors** at 2pm\n1. Bins out\n  \n")).toEqual([
      "Fire alarm test at 11", "Visitors at 2pm", "Bins out",
    ]);
  });
  it("handles nothing", () => {
    expect(reminderLinesFromNote(null)).toEqual([]);
    expect(reminderLinesFromNote("  -  \n")).toEqual([]);
  });
});
