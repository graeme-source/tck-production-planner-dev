import { describe, expect, it } from "vitest";
import { EMPTY_TODO_FORM, insertOpenTodo, todoCreateBody, todoEditPatch, todoFormFrom, todoFormValid, type TodoEditable } from "./todo-edit";

const task = (over: Partial<TodoEditable> = {}): TodoEditable => ({
  title: "Deep-clean the pass fridge",
  notes: null,
  url: null,
  priority: "normal",
  scheduled_for: null,
  due_date: "2026-10-15",
  ...over,
});

describe("todoEditPatch", () => {
  it("is null when nothing changed (grey save button, no close question)", () => {
    const t = task({ notes: "Use the blue spray" });
    expect(todoEditPatch(t, todoFormFrom(t))).toBeNull();
  });

  it("ignores whitespace-only differences and blank-vs-null", () => {
    const t = task({ notes: "Use the blue spray" });
    const f = { ...todoFormFrom(t), title: "  Deep-clean the pass fridge ", notes: "Use the blue spray  ", url: "   " };
    expect(todoEditPatch(t, f)).toBeNull();
  });

  it("sends only the fields that changed", () => {
    const t = task();
    const f = { ...todoFormFrom(t), priority: "urgent" as const, notes: "Before 10am" };
    expect(todoEditPatch(t, f)).toEqual({ priority: "urgent", notes: "Before 10am" });
  });

  it("clearing a date or a note sends null (the server clears it)", () => {
    const t = task({ notes: "old", scheduled_for: "2026-10-14" });
    const f = { ...todoFormFrom(t), notes: "", scheduledFor: "", dueDate: "" };
    expect(todoEditPatch(t, f)).toEqual({ notes: null, scheduledFor: null, dueDate: null });
  });

  it("trims a changed title", () => {
    expect(todoEditPatch(task(), { ...todoFormFrom(task()), title: "  Order gloves " })).toEqual({ title: "Order gloves" });
  });
});

describe("insertOpenTodo", () => {
  type P = "urgent" | "high" | "normal" | "low";
  const row = (id: number, over: Partial<{ priority: P; due_date: string | null; scheduled_for: string | null; created_at: string }> = {}) => ({
    id, priority: "normal" as P, due_date: null as string | null, scheduled_for: null as string | null, created_at: `2026-10-0${id} 09:00:00`, ...over,
  });

  it("puts a new normal task with no dates at the end of the normals, before low", () => {
    const list = [row(1, { priority: "urgent" }), row(2, { due_date: "2026-10-14" }), row(3), row(4, { priority: "low" })];
    const added = row(9, { created_at: "2026-10-13 12:00:00" });
    expect(insertOpenTodo(list, added).map(t => t.id)).toEqual([1, 2, 3, 9, 4]);
  });

  it("an urgent task goes to the top; a dated one before undated", () => {
    const list = [row(1), row(2)];
    expect(insertOpenTodo(list, row(9, { priority: "urgent" })).map(t => t.id)).toEqual([9, 1, 2]);
    expect(insertOpenTodo(list, row(9, { due_date: "2026-10-20" })).map(t => t.id)).toEqual([9, 1, 2]);
  });

  it("never duplicates a task already on the list", () => {
    expect(insertOpenTodo([row(1), row(9)], row(9)).map(t => t.id)).toEqual([1, 9]);
  });
});

describe("todoFormValid / todoCreateBody", () => {
  it("needs a title", () => {
    expect(todoFormValid(EMPTY_TODO_FORM)).toBe(false);
    expect(todoFormValid({ ...EMPTY_TODO_FORM, title: "   " })).toBe(false);
    expect(todoFormValid({ ...EMPTY_TODO_FORM, title: "Order gloves" })).toBe(true);
  });

  it("builds the create body with blanks as null", () => {
    expect(todoCreateBody({ ...EMPTY_TODO_FORM, title: " Order gloves ", url: " " }, 7)).toEqual({
      assigneeId: 7, title: "Order gloves", notes: null, url: null, priority: "normal", scheduledFor: null, dueDate: null,
    });
  });
});
