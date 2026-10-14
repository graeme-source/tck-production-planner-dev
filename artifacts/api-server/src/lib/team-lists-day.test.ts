import { describe, expect, it } from "vitest";
import {
  buildDay, canAccessList, canCreateList, canEditList, canTickOccurrence, comingUp, membersForNewList, teamListsVisible,
  type DayCompletion, type DayItem,
} from "./team-lists-day";
import { londonDateString } from "./london-time";

// 2026-10-13 is a Tuesday.
const MON = "2026-10-12", TUE = "2026-10-13", WED = "2026-10-14", THU = "2026-10-15";

function item(over: Partial<DayItem> & { id: number }): DayItem {
  return {
    priority: 4, timeOfDay: null, sortOrder: 0, recurrence: { kind: "daily" },
    carryOver: false, startDate: "2026-01-01", active: true, ...over,
  };
}
function done(itemId: number, dueDate: string, status = "done"): DayCompletion {
  return { itemId, dueDate, status, byName: "Lorna", at: `${dueDate}T08:00:00.000Z` };
}

describe("access (Graeme, 2026-10-14: if I tick you, you've got access)", () => {
  const admin = { id: 1, role: "admin" }, manager = { id: 2, role: "manager" }, viewer = { id: 3, role: "viewer" };
  it("admins can always open every list, even with nobody ticked", () => {
    expect(canAccessList(admin, { memberIds: [] })).toBe(true);
    expect(canAccessList(admin, { memberIds: [2] })).toBe(true);
    expect(canAccessList(admin, { memberIds: null })).toBe(true);
  });
  it("a ticked person of any role can open it — viewers included", () => {
    const list = { memberIds: [2, 3] };
    expect(canAccessList(manager, list)).toBe(true);
    expect(canAccessList(viewer, list)).toBe(true);
  });
  it("not ticked = no access, managers included (no more 'empty means every manager')", () => {
    expect(canAccessList(manager, { memberIds: [] })).toBe(false);
    expect(canAccessList(manager, { memberIds: [5] })).toBe(false);
    expect(canAccessList(viewer, { memberIds: [] })).toBe(false);
    expect(canAccessList(viewer, { memberIds: null })).toBe(false);
  });
  it("editing the list: managers and admins who can open it; ticked viewers only tick", () => {
    expect(canEditList(admin, { memberIds: [] })).toBe(true);
    expect(canEditList(manager, { memberIds: [2] })).toBe(true);
    expect(canEditList(manager, { memberIds: [] })).toBe(false);
    expect(canEditList(viewer, { memberIds: [3] })).toBe(false);
  });
  it("only managers and admins create lists", () => {
    expect(canCreateList(manager)).toBe(true);
    expect(canCreateList(admin)).toBe(true);
    expect(canCreateList(viewer)).toBe(false);
  });
  it("a manager who creates a list is ticked on it; an admin isn't added", () => {
    expect(membersForNewList(manager, [7])).toEqual([7, 2]);
    expect(membersForNewList(manager, [2, 7])).toEqual([2, 7]);
    expect(membersForNewList(admin, [7])).toEqual([7]);
  });
});

describe("visibility", () => {
  it("shows the Team lists section only to people with at least one list", () => {
    expect(teamListsVisible({ id: 3, role: "viewer" }, 1)).toBe(true);
    expect(teamListsVisible({ id: 3, role: "viewer" }, 0)).toBe(false);
    expect(teamListsVisible({ id: 2, role: "manager" }, 0)).toBe(false);
    expect(teamListsVisible({ id: 2, role: "manager" }, 2)).toBe(true);
  });
  it("admins always see it, so they can create the first list", () => {
    expect(teamListsVisible({ id: 1, role: "admin" }, 0)).toBe(true);
  });
});

describe("today's view", () => {
  it("shows items due today, P1 first, then by time, then list order", () => {
    const items = [
      item({ id: 1, priority: 4, sortOrder: 0 }),
      item({ id: 2, priority: 1, timeOfDay: "10:00" }),
      item({ id: 3, priority: 1, timeOfDay: "08:30" }),
      item({ id: 4, priority: 1 }),
      item({ id: 5, priority: 4, sortOrder: -1 }),
      item({ id: 6, recurrence: { kind: "weekly", days: [4] } }), // Thursday: not today
    ];
    expect(buildDay(items, [], TUE).entries.map(e => e.itemId)).toEqual([3, 2, 4, 5, 1]);
  });

  it("a daily item missed yesterday does not carry over", () => {
    const { entries } = buildDay([item({ id: 1, carryOver: false })], [], TUE);
    expect(entries).toEqual([{ itemId: 1, dueDate: TUE, overdue: false, completion: null }]);
  });

  it("a weekly item missed on Monday shows as overdue from Monday until done", () => {
    const weekly = item({ id: 1, recurrence: { kind: "weekly", days: [1] }, carryOver: true });
    expect(buildDay([weekly], [], WED).entries).toEqual([{ itemId: 1, dueDate: MON, overdue: true, completion: null }]);
    expect(buildDay([weekly], [], WED).progress).toEqual({ total: 1, done: 0, overdue: 1 });
    // Ticked late on Wednesday → closes Monday's occurrence; it stays in
    // Wednesday's view as done (so the count reads 1 of 1), then leaves.
    const lateTick = { ...done(1, MON), atDate: WED };
    expect(buildDay([weekly], [lateTick], WED).entries[0]).toMatchObject({ dueDate: MON, overdue: true, completion: { status: "done" } });
    expect(buildDay([weekly], [lateTick], WED).progress).toEqual({ total: 1, done: 1, overdue: 0 });
    expect(buildDay([weekly], [lateTick], THU).entries).toEqual([]);
    expect(buildDay([weekly], [{ ...done(1, MON), atDate: MON }], WED).entries).toEqual([]);
  });

  it("an overdue item ticked today stays visible while it is still today's", () => {
    const weekly = item({ id: 1, recurrence: { kind: "weekly", days: [2] }, carryOver: true });
    const day = buildDay([weekly], [done(1, TUE)], TUE);
    expect(day.entries[0].completion?.byName).toBe("Lorna");
    expect(day.progress).toEqual({ total: 1, done: 1, overdue: 0 });
  });

  it("the next occurrence replaces a missed one", () => {
    const monThu = item({ id: 1, recurrence: { kind: "weekly", days: [1, 4] }, carryOver: true });
    expect(buildDay([monThu], [], THU).entries).toEqual([{ itemId: 1, dueDate: THU, overdue: false, completion: null }]);
  });

  it("a weekly item without carry-over just disappears when missed", () => {
    const weekly = item({ id: 1, recurrence: { kind: "weekly", days: [1] }, carryOver: false });
    expect(buildDay([weekly], [], WED).entries).toEqual([]);
  });

  it("skipped counts as closed", () => {
    const weekly = item({ id: 1, recurrence: { kind: "weekly", days: [1] }, carryOver: true });
    expect(buildDay([weekly], [done(1, MON, "skipped")], WED).entries).toEqual([]);
    expect(buildDay([weekly], [done(1, MON, "skipped")], MON).entries[0].completion?.status).toBe("skipped");
  });

  it("an item is never overdue from before it was created", () => {
    const weekly = item({ id: 1, recurrence: { kind: "weekly", days: [1] }, carryOver: true, startDate: TUE });
    expect(buildDay([weekly], [], WED).entries).toEqual([]);
  });

  it("removed (inactive) items never show", () => {
    expect(buildDay([item({ id: 1, active: false })], [], TUE).entries).toEqual([]);
  });

  it("counts progress: 1 of 3 done, 1 overdue", () => {
    const items = [
      item({ id: 1 }),
      item({ id: 2 }),
      item({ id: 3, recurrence: { kind: "weekly", days: [1] }, carryOver: true }),
    ];
    expect(buildDay(items, [done(1, TUE)], TUE).progress).toEqual({ total: 3, done: 1, overdue: 1 });
  });
});

describe("London date edges", () => {
  it("00:30 London on the day BST ends is already Sunday the 25th", () => {
    // 23:30 UTC on Sat 24 Oct is 00:30 BST on Sun 25 Oct.
    const today = londonDateString(new Date("2026-10-24T23:30:00Z"));
    expect(today).toBe("2026-10-25");
    const sundays = item({ id: 1, recurrence: { kind: "weekly", days: [0] } });
    expect(buildDay([sundays], [], today).entries).toHaveLength(1);
  });
  it("23:30 London on the day BST starts is still Sunday the 29th", () => {
    // After the spring change, 22:30 UTC = 23:30 BST.
    const today = londonDateString(new Date("2026-03-29T22:30:00Z"));
    expect(today).toBe("2026-03-29");
    const mondays = item({ id: 1, recurrence: { kind: "weekly", days: [1] } });
    expect(buildDay([mondays], [], today).entries).toHaveLength(0);
  });
  it("a weekday item at 23:30 UTC on a summer Sunday is due (it is Monday in London)", () => {
    const today = londonDateString(new Date("2026-07-05T23:30:00Z"));
    expect(today).toBe("2026-07-06");
    expect(buildDay([item({ id: 1, recurrence: { kind: "weekdays" } })], [], today).entries).toHaveLength(1);
  });
});

describe("ticking", () => {
  it("allows today's occurrence and the carried-over one, never the future", () => {
    const weekly = item({ id: 1, recurrence: { kind: "weekly", days: [1] }, carryOver: true });
    expect(canTickOccurrence(weekly, MON, WED)).toBe(true);
    expect(canTickOccurrence(weekly, "2026-10-19", WED)).toBe(false);
    expect(canTickOccurrence(weekly, "2026-10-05", WED)).toBe(false);
    expect(canTickOccurrence(item({ id: 2 }), TUE, TUE)).toBe(true);
    expect(canTickOccurrence(item({ id: 2 }), MON, TUE)).toBe(false);
  });
});

describe("coming up", () => {
  it("lists the next seven days that have something due", () => {
    const items = [
      item({ id: 1, recurrence: { kind: "weekly", days: [4] } }),
      item({ id: 2, recurrence: { kind: "weekly", days: [4] }, priority: 1 }),
      item({ id: 3, recurrence: { kind: "monthly", dayOfMonth: 1 } }),
      item({ id: 4 }), // daily: left out
      item({ id: 5, recurrence: { kind: "weekdays" } }),
    ];
    expect(comingUp(items, TUE)).toEqual([{ date: THU, itemIds: [2, 1] }]);
  });
});
