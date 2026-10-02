import { describe, expect, it } from "vitest";
import { groupTodosByDay, todoGroupLabel } from "./calendar-todo-groups";

const t = (id: number, date: string, done = false) => ({ id, date, done });

describe("calendar to-do grouping (2026-10-02)", () => {
  it("a quiet day shows each to-do", () => {
    const g = groupTodosByDay([t(1, "2026-10-02"), t(2, "2026-10-02")]);
    expect(g.map(x => x.kind)).toEqual(["one", "one"]);
  });
  it("a busy day becomes one chip, open ones first", () => {
    const g = groupTodosByDay([t(1, "2026-10-02", true), t(2, "2026-10-02"), t(3, "2026-10-02"), t(4, "2026-10-03")]);
    expect(g).toHaveLength(2);
    expect(g[0].kind).toBe("group");
    if (g[0].kind === "group") expect(g[0].todos.map(x => x.id)).toEqual([2, 3, 1]);
    expect(g[1]).toEqual({ kind: "one", date: "2026-10-03", todo: t(4, "2026-10-03") });
  });
  it("labels the chip", () => {
    expect(todoGroupLabel([t(1, "d"), t(2, "d", true), t(3, "d")])).toBe("3 to-dos · 1 done");
    expect(todoGroupLabel([t(1, "d"), t(2, "d"), t(3, "d")])).toBe("3 to-dos");
  });
});
