import { describe, expect, it } from "vitest";
import { dayHeading, defaultCarryOver, doneByLabel, overdueLabel, presetOf, ruleForPreset } from "./team-list-view";

const TUE = "2026-10-13";

describe("presets", () => {
  it("maps rules to the preset buttons", () => {
    expect(presetOf({ kind: "daily" })).toBe("daily");
    expect(presetOf({ kind: "weekly", days: [2] })).toBe("weekly");
    expect(presetOf({ kind: "weekly", days: [1, 4] })).toBe("days");
    expect(presetOf({ kind: "weekly", days: [5], interval: 2, anchor: TUE })).toBe("every_n");
    expect(presetOf({ kind: "monthly", dayOfMonth: 3 })).toBe("monthly");
  });
  it("builds a rule from a preset, keeping the days it can", () => {
    expect(ruleForPreset("weekly", { kind: "daily" }, TUE)).toEqual({ kind: "weekly", days: [2] });
    expect(ruleForPreset("weekly", { kind: "weekly", days: [1, 4] }, TUE)).toEqual({ kind: "weekly", days: [1] });
    expect(ruleForPreset("days", { kind: "weekly", days: [4] }, TUE)).toEqual({ kind: "weekly", days: [4] });
    expect(ruleForPreset("every_n", { kind: "weekly", days: [5] }, TUE)).toEqual({ kind: "weekly", days: [5], interval: 2, anchor: "2026-10-16" });
    expect(ruleForPreset("monthly", { kind: "daily" }, TUE)).toEqual({ kind: "monthly", dayOfMonth: 13 });
  });
  it("keeps an existing every-N-weeks rule's anchor", () => {
    const rule = { kind: "weekly" as const, days: [5 as const], interval: 3, anchor: "2026-10-02" };
    expect(ruleForPreset("every_n", rule, TUE)).toBe(rule);
  });
  it("carry-over defaults off for daily rhythms, on otherwise", () => {
    expect(defaultCarryOver({ kind: "daily" })).toBe(false);
    expect(defaultCarryOver({ kind: "weekdays" })).toBe(false);
    expect(defaultCarryOver({ kind: "weekly", days: [2] })).toBe(true);
    expect(defaultCarryOver({ kind: "monthly", dayOfMonth: 1 })).toBe(true);
  });
});

describe("labels", () => {
  it("says which day an overdue task is from", () => {
    expect(overdueLabel("2026-10-12", TUE)).toBe("Overdue (from yesterday)");
    expect(overdueLabel("2026-10-08", TUE)).toBe("Overdue (from Thu)");
    expect(overdueLabel("2026-10-01", TUE)).toBe("Overdue (from 1 Oct)");
  });
  it("shows who ticked it, in London time", () => {
    // 07:12 UTC in October = 08:12 BST.
    expect(doneByLabel("Lorna", "2026-10-13T07:12:00.000Z", TUE)).toBe("Lorna · 08:12");
    expect(doneByLabel(null, "2026-10-12T15:00:00.000Z", TUE)).toBe("Someone · Mon 16:00");
  });
  it("names the coming-up days", () => {
    expect(dayHeading("2026-10-14", TUE)).toBe("Tomorrow");
    expect(dayHeading("2026-10-15", TUE)).toBe("Thursday 15 Oct");
  });
});
