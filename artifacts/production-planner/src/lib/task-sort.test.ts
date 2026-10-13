import { describe, expect, it } from "vitest";
import {
  parseSortSpec, sortSpecLabel, sortTasks, sortTodos, type SortSpec, type TaskSortFields,
} from "./task-sort";

type Row = TaskSortFields;
const row = (title: string, priority: number, time: string | null, order: number, overdue = false): Row =>
  ({ title, priority, time, order, overdue });
const titles = (rows: Row[]) => rows.map(r => r.title);
const sort = (rows: Row[], spec: SortSpec) => titles(sortTasks(rows, spec, r => r));

const TIME_THEN_PRIORITY: SortSpec = { primary: "time", secondary: "priority" };
const PRIORITY_THEN_TIME: SortSpec = { primary: "priority", secondary: "time" };

// Graeme's example: two reds (P1) due 15:00 and 16:00, plus untimed tasks
// and lower priorities, in a deliberately jumbled list order.
const graeme = [
  row("P3 untimed", 3, null, 0),
  row("P1 at 16:00", 1, "16:00", 1),
  row("P4 at 09:00", 4, "09:00", 2),
  row("P1 untimed", 1, null, 3),
  row("P1 at 15:00", 1, "15:00", 4),
  row("P2 at 15:00", 2, "15:00", 5),
];

describe("sortTasks", () => {
  it("Time, then Priority: 15:00 P1 before 16:00 P1, priority breaks ties at the same time, untimed last", () => {
    expect(sort(graeme, TIME_THEN_PRIORITY)).toEqual([
      "P4 at 09:00", "P1 at 15:00", "P2 at 15:00", "P1 at 16:00", "P1 untimed", "P3 untimed",
    ]);
  });

  it("Priority, then Time: the two reds in time order, then the rest", () => {
    expect(sort(graeme, PRIORITY_THEN_TIME)).toEqual([
      "P1 at 15:00", "P1 at 16:00", "P1 untimed", "P2 at 15:00", "P3 untimed", "P4 at 09:00",
    ]);
  });

  it("List order only follows the list's own order", () => {
    expect(sort(graeme, { primary: "manual", secondary: "none" })).toEqual(titles(graeme));
  });

  it("Time with no second rule falls back to list order, then title, for ties", () => {
    const rows = [row("Zed", 1, "10:00", 2), row("Bee", 4, "10:00", 1), row("Ant", 2, "10:00", 1)];
    expect(sort(rows, { primary: "time", secondary: "none" })).toEqual(["Ant", "Bee", "Zed"]);
  });

  it("puts overdue tasks first when sorting by time, oldest first", () => {
    const rows = [
      row("Today 08:00", 2, "2026-10-13 08:00", 0),
      row("Overdue Sat", 3, "2026-10-10 99:99", 1, true),
      row("Overdue Mon 14:00", 1, "2026-10-12 14:00", 2, true),
      row("Untimed", 1, null, 3),
    ];
    expect(sort(rows, TIME_THEN_PRIORITY)).toEqual(["Overdue Sat", "Overdue Mon 14:00", "Today 08:00", "Untimed"]);
  });

  it("ignores a second rule that repeats the first", () => {
    expect(sort(graeme, { primary: "priority", secondary: "priority" }))
      .toEqual(["P1 at 16:00", "P1 untimed", "P1 at 15:00", "P2 at 15:00", "P3 untimed", "P4 at 09:00"]);
  });

  it("does not change the input", () => {
    const copy = [...graeme];
    sortTasks(graeme, TIME_THEN_PRIORITY, r => r);
    expect(graeme).toEqual(copy);
  });
});

describe("sortTodos", () => {
  const todo = (id: number, title: string, priority: string, scheduled_for: string | null, due_date: string | null, created_at: string) =>
    ({ id, title, priority, scheduled_for, due_date, created_at });
  const tasks = [
    todo(1, "Normal due Fri", "normal", null, "2026-10-16", "2026-10-01 09:00"),
    todo(2, "Urgent no date", "urgent", null, null, "2026-10-02 09:00"),
    todo(3, "Low overdue", "low", null, "2026-10-10", "2026-10-03 09:00"),
    todo(4, "High do today, due Fri", "high", "2026-10-13", "2026-10-16", "2026-09-30 09:00"),
  ];
  const overdue = (t: { due_date: string | null }) => !!t.due_date && t.due_date < "2026-10-13";

  it("Priority, then Time (the My To-dos default)", () => {
    expect(sortTodos(tasks, PRIORITY_THEN_TIME, overdue).map(t => t.id)).toEqual([2, 4, 1, 3]);
  });
  it("Time, then Priority: overdue first, then the earliest of do/due date, undated last", () => {
    expect(sortTodos(tasks, TIME_THEN_PRIORITY, overdue).map(t => t.id)).toEqual([3, 4, 1, 2]);
  });
  it("List order is the order they were added", () => {
    expect(sortTodos(tasks, { primary: "manual", secondary: "none" }, overdue).map(t => t.id)).toEqual([4, 1, 2, 3]);
  });
});

describe("labels and stored choices", () => {
  it("words the choice", () => {
    expect(sortSpecLabel(TIME_THEN_PRIORITY)).toBe("Time, then Priority");
    expect(sortSpecLabel({ primary: "manual", secondary: "none" })).toBe("List order");
  });
  it("reads back a stored choice, falling back on anything odd", () => {
    expect(parseSortSpec(JSON.stringify(PRIORITY_THEN_TIME), TIME_THEN_PRIORITY)).toEqual(PRIORITY_THEN_TIME);
    expect(parseSortSpec("not json", TIME_THEN_PRIORITY)).toEqual(TIME_THEN_PRIORITY);
    expect(parseSortSpec(JSON.stringify({ primary: "colour", secondary: "none" }), TIME_THEN_PRIORITY)).toEqual(TIME_THEN_PRIORITY);
    expect(parseSortSpec(null, TIME_THEN_PRIORITY)).toEqual(TIME_THEN_PRIORITY);
    expect(parseSortSpec(JSON.stringify({ primary: "time", secondary: "time" }), PRIORITY_THEN_TIME)).toEqual({ primary: "time", secondary: "none" });
  });
});
